'use strict';

const _ = require('lodash');
const utils = require('@frctl/fractal').utils;

module.exports = {
	install(Vue, fractal) {
		Vue.mixin({
			methods: {
				path(path) {
					const env = this._env;
					const request = env.request || this._request;

					return (! env || env.server) ? path : utils.relUrlPath(path, _.get(request, 'path', '/'), fractal.web.get('builder.urls'));
				}
			}
		});
	}
};
