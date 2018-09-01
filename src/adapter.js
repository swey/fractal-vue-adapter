'use strict';

const Vue = require('vue');
const VueServerRenderer = require('vue-server-renderer');
const fs = require('fs');
const Adapter = require('@frctl/fractal').Adapter;
const PathPlugin = require('./plugins/PathPlugin');
const vueTemplateCompiler = require('vue-template-compiler');
const babel = require('babel-core');
const babelPreset = require('babel-preset-env');
const requireFromString = require('require-from-string');
const merge = require('lodash').merge;

class VueAdapter extends Adapter {
	constructor(source, app, config) {
		super(null, source);

		this._app = app;
		this._config = config;

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

		// As soon a view changes, the vue component definition needs to be updated
		this.on('view:updated', this.updateVueComponent.bind(this));
		this.on('view:removed', this.updateVueComponent.bind(this));
		this.on('wrapper:updated', this.updateVueComponent.bind(this));
		this.on('wrapper:removed', this.updateVueComponent.bind(this));

		require.extensions['.vue'] = (module, filename) => {
			const content = fs.readFileSync(filename, 'utf8');

			const parsedComponent = this.parseSingleFileVueComponent(content, filename);

			module._compile(parsedComponent.scriptCode, filename);
		}
	}

	render(path, str, context, meta) {
		meta = meta || {};

		const renderer = VueServerRenderer.createRenderer();
		const parsedComponent = this.parseSingleFileVueComponent(str, path);

		// Create the data object for the root element
		if (parsedComponent.script.data) {
			parsedComponent.script.data = parsedComponent.script.data();
		}

		context._config = this._app.config();
		context._env = meta.env;

		const vue = new Vue(merge({
			props: Array.isArray(context.props) ? ['yield', '_env', '_config'] : {
				yield: {
					type: String,
					required: true
				},
				_env: {
					type: Object,
					required: true
				},
				_config: {
					type: Object,
					required: true
				}
			},
			propsData: context,
			template: parsedComponent.template
		}, parsedComponent.script));

		return renderer.renderToString(vue).then(html => {
			// Return the html without the empty comments used by Vue (v-if usage)
			return html.replace(/<!---->/g, '');
		}).catch(err => {
			console.error(err);
			return err;
		});
	}

	updateVueComponent(view) {
		Object.keys(require.cache).forEach(key => {
			if (key.includes('.vue')) {
				delete require.cache[key];
			}
		});
	}

	parseSingleFileVueComponent(content, path = '') {
		// Parse file content
		const component = vueTemplateCompiler.parseComponent(content);

		// Not a single file component (Please note: in cases with a render function the template can be missing)
		if (!component.template && !component.script) {
			return {
				template: content,
				script: {},
				scriptCode: '',
			}
		}

		// Extract template (Please note: in cases with a render function the template can be missing)
		const template = component.template ? component.template.content : '';

		// Inject template to script content
		component.script.content = component.script.content.replace(/export default {/, 'export default { template: '+JSON.stringify(template)+',');

		// Transpile ES6 to consumable script
		const scriptCode = babel.transform(component.script.content, Object.assign({ filename: path }, this._babelOptions)).code;

		// Compile script
		const script = requireFromString(scriptCode, path).default; // TODO move to render function, not needed globally anymore

		return {
			template,
			script,
			scriptCode,
		};
	}
}

module.exports = config => {
	config = config || {};

	return {
		register(source, app) {
			const adapter = new VueAdapter(source, app, config);

			return adapter;
		}
	}
};
