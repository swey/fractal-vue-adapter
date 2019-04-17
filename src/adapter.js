'use strict';

const Vue = require('vue');
const VueServerRenderer = require('vue-server-renderer');
const fs = require('fs');
const Adapter = require('@frctl/fractal').Adapter;
const PathPlugin = require('./plugins/PathPlugin');
const vueTemplateCompiler = require('vue-template-compiler');
const babel = require('babel-core');
const babelPreset = require('babel-preset-env');

const DEFAULT_PAGE_TEMPLATE = '<!DOCTYPE html>\n<!--vue-ssr-outlet-->';

class VueAdapter extends Adapter {
	constructor(source, app, config) {
		super(null, source);

		this._app = app;
		this._config = config;
		this._appConfig = Object.assign({}, this._app.config(), { docs: null });

		Vue.use(PathPlugin, app);

		this._babelOptions = Object.assign({
			presets: [
				[babelPreset, {
					targets: {
						node: 'current'
					}
				}]
			]
		}, this._config.babel);

		this._vuePageRenderer = VueServerRenderer.createRenderer({
			template: config.pageTemplate
		});

		this._vueRenderer = VueServerRenderer.createRenderer();

		// As soon a source changes, the vue component definition needs to be updated
		source.on('updated', this.clearRequireCache.bind(this));

		require.extensions['.vue'] = (module, filename) => {
			const content = fs.readFileSync(filename, 'utf8');

			try {
				const parsedComponent = this.parseSingleFileVueComponent(content, filename);
				module._compile(parsedComponent, filename);
			} catch (error) {
				console.warn(error);
				throw new Error(error);
			}
		};
	}

	render(path, str, context, meta) {
		meta = meta || {};

		context._target = meta.target;
		context._env = meta.env;
		context._config = this._appConfig;

		const VueComponent = require(path).default;

		const vm = new Vue({
			render: createElement => createElement(VueComponent, { props: context }) // Please note: Needs to be "props" instead of "propsData" in this case
		});

		// Only use the page renderer with page template for the preview layout rendering (if meta has "target" or context has "yield")
		const renderer = meta.target ? this._vuePageRenderer : this._vueRenderer;

		return renderer.renderToString(vm).catch(err => {
			console.error(err);
			return err;
		});
	}

	parseSingleFileVueComponent(content, path = '') {
		// Parse file content
		const component = vueTemplateCompiler.parseComponent(content);

		// Not a single file component (Please note: in cases with a render function the template can be missing)
		if (!component.template && !component.script) {
			return {
				template: content
			};
		}

		// Extract template (Please note: in cases with a render function the template can be missing)
		const template = component.template ? component.template.content : null;

		if (template) {
			// Inject template to script content
			component.script.content = component.script.content.replace(/export default {/, `export default { template: ${JSON.stringify(template)}, __file: '${path}', `);
		}

		// Transpile ES6 to consumable script
		return babel.transform(component.script.content, Object.assign({ filename: path }, this._babelOptions)).code;
	}

	clearRequireCache() {
		Object.keys(require.cache).forEach(key => {
			if (key.includes('.vue')) {
				delete require.cache[key];
			}
		});
	}
}

module.exports = config => {
	config = config || {};

	config.pageTemplate = config.pageTemplate || DEFAULT_PAGE_TEMPLATE;

	return {
		register(source, app) {
			const adapter = new VueAdapter(source, app, config);

			return adapter;
		}
	};
};
