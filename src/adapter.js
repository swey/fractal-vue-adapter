'use strict';

const Vue = require('vue');
const VueServerRenderer = require('vue-server-renderer');
const fs = require('fs');
const Adapter = require('@frctl/fractal').Adapter;
const PathPlugin = require('./plugins/PathPlugin');

class VueAdapter extends Adapter {
	constructor(source, app, config) {
		super(null, source);

		this._app = app;
		this._config = config;

		Vue.use(PathPlugin);

		source.components().items().forEach(item => {
			// Auto define props based on the keys used in the config
			const props = Object.keys(item.configData.context);

			// Register all items as Vue components
			fs.readFileAsync(item.viewPath, 'utf8').then(template => {
				Vue.component(item.name, {
					template,
					props,
				});
			});
		});
	}

	render(path, str, context, meta) {
		meta = meta || {};

		const renderer = VueServerRenderer.createRenderer();

		const config = this._app.config();

		const vue = new Vue({
			data: context,
			template: str,
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
		});

		return renderer.renderToString(vue).then(html => {
			return html;
		}).catch(err => {
			console.error(err);
			return err;
		});
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
