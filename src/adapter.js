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

		app.components.flatten().forEach(component => {
			// Auto define props based on the keys used in the config (only used as fallback if no props were defined)
			const autoProps = component.configData ? Object.keys(component.configData.context) : [];

			// Register all fractal components as Vue components
			fs.readFileAsync(component.viewPath, 'utf8').then(content => {
				const parsedComponent = this.parseSingleFileVueComponent(content, component.viewPath);

				// Remove component definitions since they are registered globally
				parsedComponent.script.components = null;

				Vue.component(component.name, Object.assign({
					template: parsedComponent.template,
					props: parsedComponent.script.props ? null : autoProps,
				}, parsedComponent.script));
			});
		});

		// As soon a view changes, the vue component definition needs to be updated
		this.on('view:updated', this.updateVueComponent.bind(this));
		this.on('view:removed', this.updateVueComponent.bind(this));
		this.on('wrapper:updated', this.updateVueComponent.bind(this));
		this.on('wrapper:removed', this.updateVueComponent.bind(this));

		// Fractal does not need the component imports since they are registered globally
		require.extensions['.vue'] = () => ({})
	}

	render(path, str, context, meta) {
		meta = meta || {};

		const renderer = VueServerRenderer.createRenderer();
		const parsedComponent = this.parseSingleFileVueComponent(str, path);

		// Remove component definitions since they are registered globally
		parsedComponent.script.components = null;

		// Create the data object for the root element
		if (parsedComponent.script.data) {
			parsedComponent.script.data = parsedComponent.script.data();
		}

		const config = this._app.config();

		const vue = new Vue(merge({
			propsData: context,
			data: {
				yield: context.yield || '' // (The variable is used by fractal to pass rendered content to the preview layouts)
			},
			template: parsedComponent.template,
			computed: {
				_self() {
					return meta.self;
				},
				_env() {
					return meta.env;
				},
				_config() {
					return config;
				}
			}
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
		const component = this._source.find(view.handle);

		const parsedComponent = this.parseSingleFileVueComponent(component.content, component.viewPath);

		// Remove component definitions since they are registered globally
		parsedComponent.script.components = null;

		// Auto define props based on the keys used in the config (only used as fallback if no props were defined)
		const autoProps = component.configData ? Object.keys(component.configData.context) : [];

		// Update vue component
		Vue.component(component.name, Object.assign({
			template: parsedComponent.template,
			props: parsedComponent.script.props ? null : autoProps,
		}, parsedComponent.script));
	}

	parseSingleFileVueComponent(content, path = '') {
		// Parse file content
		const component = vueTemplateCompiler.parseComponent(content);

		// Not a single file component (Please note: in cases with a render function the template can be missing)
		if (!component.template && !component.script) {
			return {
				template: content,
				script: {}
			}
		}

		// Extract template (Please note: in cases with a render function the template can be missing)
		const template = component.template ? component.template.content : '';

		// Transpile ES6 to consumable script
		const scriptCode = babel.transform(component.script.content, Object.assign({
			presets: [
				[babelPreset, {
					targets: {
						node: 'current'
					}
				}]
			]
		}, this._config.babel)).code;

		// Compile script
		const script = requireFromString(scriptCode, path).default;

		return {
			template,
			script
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
