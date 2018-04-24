'use strict';

const Vue = require('vue');
const VueServerRenderer = require('vue-server-renderer');
const fs = require('fs');
const Adapter = require('@frctl/fractal').Adapter;
const PathPlugin = require('./plugins/PathPlugin');
const compiler = require('vue-template-compiler');
const babel = require('babel-core');
const preset = require('babel-preset-env');
const requireFromString = require('require-from-string');
const merge = require('lodash.merge');

function parseComponent(content = '', path = '') {
	// Parse file content
	const component = compiler.parseComponent(content);

	// Not a single file component
	if (!component.template) {
		return {
			template: content,
			script: {}
		}
	}

	// Extract template
	const template = component.template.content;

	// Transpile ES6 to consumable script
	const scriptCode = babel.transform(component.script.content, {
		presets: [
			[preset, {
				targets: {
					node: 'current'
				}
			}]
		]
	}).code;

	// Compile script
	const script = requireFromString(scriptCode, '').default;

	return {
		script,
		template
	};
}

class VueAdapter extends Adapter {
	constructor(source, app, config) {
		super(null, source);

		this._app = app;
		this._config = config;

		Vue.use(PathPlugin, app);

		app.components.flatten().forEach(component => {
			// Auto define props based on the keys used in the config
			const props = component.configData ? Object.keys(component.configData.context) : [];

			// Register all fractal components as Vue components
			fs.readFileAsync(component.viewPath, 'utf8').then(content => {
				const parsedComponent = parseComponent(content, component.viewPath);

				Vue.component(component.name, merge({
					template: parsedComponent.template,
					props,
				}, parsedComponent.script));
			});
		});

		// As soon a view changes, the vue component definition needs to be updated
		this.on('view:updated', this.updateVueComponent.bind(this));
		this.on('view:removed', this.updateVueComponent.bind(this));
		this.on('wrapper:updated', this.updateVueComponent.bind(this));
		this.on('wrapper:removed', this.updateVueComponent.bind(this));
	}

	render(path, str, context, meta) {
		meta = meta || {};

		const renderer = VueServerRenderer.createRenderer();
		const parsedComponent = parseComponent(str, path);

		const config = this._app.config();

		const vue = new Vue(merge({
			data: context,
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

		// TODO: Figure out how to pass path. view.handle?
		const parsedComponent = compiler.parseComponent(component.content);

		// Auto define props based on the keys used in the config
		const props = component.configData ? Object.keys(component.configData.context) : [];

		// Update vue component
		Vue.component(component.name, merge({
			template: parsedComponent.template,
			props
		}, parsedComponent.script));
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
