'use strict';

const Vue = require('vue');
const VueServerRenderer = require('vue-server-renderer');
const fs = require('fs');
const Adapter = require('@frctl/fractal').Adapter;

class VueAdapter extends Adapter {
	constructor(source, app, config) {
		super(null, source);

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
		const renderer = VueServerRenderer.createRenderer();

		const vue = new Vue({
			data: context,
			template: str
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
