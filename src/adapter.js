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

const DEFAULT_DOCTYPE = '<!DOCTYPE html>\n';

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

		this._vueRenderer = VueServerRenderer.createRenderer();

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

		const parsedComponent = this.parseSingleFileVueComponent(str, path);

		context._target = meta.target;
		context._env = meta.env;
		context._config = this._appConfig;

		const VueComponent = Vue.extend(merge({
			__file: path,
			props: Array.isArray(parsedComponent.script.props) ? ['yield', '_target', '_env', '_config'] : {
				yield: {
					type: String,
					default: ''
				},
				_target: {
					type: Object,
					default: null
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
			template: parsedComponent.template
		}, parsedComponent.script));

		const vm = new Vue({
			render: createElement => createElement(VueComponent, { props: context }) // Please note: Needs to be "props" instead of "propsData" in this case
		});

		return this._vueRenderer.renderToString(vm).then(html => {
			// Add docType (which well be removed by Vue Renderer
			html = this._config.docType + html;
			return html;
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
		component.script.content = component.script.content.replace(/export default {/, `export default { template: ${JSON.stringify(template)}, __file: '${path}', `)

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

	config.docType = config.docType || DEFAULT_DOCTYPE;

	return {
		register(source, app) {
			const adapter = new VueAdapter(source, app, config);

			return adapter;
		}
	}
};