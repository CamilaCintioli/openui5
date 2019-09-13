/*
 * ! ${copyright}
 */

/* global XMLHttpRequest */

sap.ui.define([
	"sap/base/security/encodeURLParameters",
	"sap/base/Log"
], function (
	encodeURLParameters,
	Log
) {
	"use strict";

	/**
	 * Util class for Connector implementations (apply).
	 *
	 * @namespace sap.ui.fl.apply._internal.connectors.Utils
	 * @since 1.70
	 * @version ${version}
	 * @private
	 * @ui5-restricted sap.ui.fl.apply._internal, sap.ui.fl.write._internal
	 */

	var APPLY_CONNECTOR_NAME_SPACE = "sap/ui/fl/apply/_internal/connectors/";
	var STATIC_FILE_CONNECTOR_CONFIGURATION = {
		layerFilter: [],
		connector: "StaticFileConnector"
	};

	function _filterValidLayers (aLayers, aValidLayers) {
		return aLayers.filter(function (sLayer) {
			return aValidLayers.indexOf(sLayer) !== -1 || aValidLayers[0] === "ALL";
		});
	}

	return {
		/**
		 * Provides all mandatory connectors required to apply or write data depending on the given namespace.
		 *
		 * @param {string} sNameSpace Namespace to determine the path to the configured connectors
		 * @param {boolean} bIncludingStaticFileConnector Flag to determine if StaticFileConnector should be included
		 * @returns {Promise<map[]>} Resolving with a list of maps for all configured connectors and their requested modules
		 */
		getConnectors: function(sNameSpace, bIncludingStaticFileConnector) {
			var aConfiguredConnectors = sap.ui.getCore().getConfiguration().getFlexibilityServices();
			var mConnectors = [];
			if (bIncludingStaticFileConnector) {
				mConnectors = [STATIC_FILE_CONNECTOR_CONFIGURATION];
			}

			mConnectors = mConnectors.concat(aConfiguredConnectors);

			return new Promise(function (resolve) {
				var aConnectors = mConnectors.map(function (mConnectorConfiguration) {
					var sConnector = mConnectorConfiguration.connector;
					return mConnectorConfiguration.custom ? sConnector : sNameSpace + sConnector;
				});

				sap.ui.require(aConnectors, function () {
					Array.from(arguments).forEach(function (oConnector, iIndex) {
						if (!mConnectors[iIndex].layers) {
							mConnectors[iIndex].layers = oConnector.layers;
						} else {
							mConnectors[iIndex].layers = _filterValidLayers(mConnectors[iIndex].layers, oConnector.layers);
						}
						mConnectors[iIndex].connectorModule = oConnector;
					});

					resolve(mConnectors);
				});
			});
		},

		/**
		 * Provides all mandatory connectors required to read data for the apply case; these are the static file connector as well as all connectors
		 * mentioned in the core-Configuration.
		 *
		 * @returns {Promise<map[]>} Resolving with a list of maps for all configured apply connectors and their requested modules
		 */
		getApplyConnectors: function () {
			return this.getConnectors(APPLY_CONNECTOR_NAME_SPACE, true);
		},

		/**
		 * Creates a Error messages in case of a failed Connector call while getting responses from multiple endpoints
		 *
		 * @param {object} oResponse Response from the sent request
		 * @param {object} oConnectorConfig Configured Connector
		 * @param {string} sFunctionName Name of the called function
		 * @param {string} sErrorMessage Error messages retrieved from the endpoint
		 * @returns {object} oResponse Response from the endpoint
		 */
		logAndResolveDefault: function(oResponse, oConnectorConfig, sFunctionName, sErrorMessage) {
			Log.error("Connector (" + oConnectorConfig.connector + ") failed call '" + sFunctionName + "': " + sErrorMessage);
			return oResponse;
		},

		/**
		 * Creating a full request url. Generic Method for all Connectors.
		 * This includes the url prefix and optional cache buster token, flex reference and query parameters.
		 *
		 * @param {string} sRoute Url-suffix e.g. "/flex/data/"
		 * @param {object} mPropertyBag Object with parameters as properties
		 * @param {string} mPropertyBag.url Configured url for the connector
		 * @param {string} [mPropertyBag.reference] Flexibility reference
		 * @param {string} [mPropertyBag.cacheKey] Cache-Buster token
		 * @param {object} [mParameters] Query-parameters which will be added to the url
		 * @returns {string} Complete request url
		 * @private
		 * @restricted sap.ui.fl.apply._internal, sap.ui.fl.write._internal
		 */
		getUrl: function(sRoute, mPropertyBag, mParameters) {
			if (!sRoute || !mPropertyBag.url) {
				throw new Error("Not all necessary parameters were passed");
			}
			var sUrl = mPropertyBag.url + sRoute;

			// If any of the following properties are available in mPropertyBag we append them to the Url
			if (mPropertyBag.cacheKey) {
				sUrl += "~" + mPropertyBag.cacheKey + "~/";
			}
			if (mPropertyBag.reference) {
				sUrl += mPropertyBag.reference;
			}

			// Adding Query-Parameters to the Url
			if (mParameters) {
				var sQueryParameters = encodeURLParameters(mParameters);

				if (sQueryParameters.length > 0) {
					sUrl += "?" + sQueryParameters;
				}
			}
			return sUrl;
		},

		/**
		 * Takes a source object and returns a target object that has a subset of properties of the source object
		 * specified in 'aKeys'.
		 *
		 * @param {object} oSource Object containing the information needed for filling oTarget
		 * @param {array<string>} aKeys Keys which should be added to oTarget
		 * @returns {object} oTarget Object containing all key-value pairs which where found in oSource
		 */
		getSubsetOfObject: function(oSource, aKeys) {
			var oTarget = {};
			if (Array.isArray(aKeys)) {
				aKeys.forEach(function (sKey) {
					if (oSource[sKey]) {
						oTarget[sKey] = oSource[sKey];
					}
				});
			}
			return oTarget;
		},

		/**
		 * Sending a xhr request and handling the response according to the status code of the response.
		 *
		 * @param {string} sUrl Url of the sent request
		 * @param {string} [sMethod="GET"] Desired action to be performed for a given resource
		 * @param {object} [mPropertyBag] Object with parameters as properties
		 * @param {string} [mPropertyBag.xsrfToken] Existing X-CSRF token of the connector which triggers the request
		 * @param {string} [mPropertyBag.flexObjects] Payload of the request
		 * @param {string} [mPropertyBag.contentType] Content type of the request
		 * @param {string} [mPropertyBag.dataType] Expected data type of the response
		 * @returns {Promise<object>} Promise resolving with the JSON parsed response of the request
		 */
		sendRequest: function(sUrl, sMethod, mPropertyBag) {
			sMethod = sMethod || "GET";
			sMethod = sMethod.toUpperCase();

			return new Promise(function (resolve, reject) {
				var xhr = new XMLHttpRequest();
				xhr.open(sMethod, sUrl);
				if ((sMethod === "GET" || sMethod === "HEAD") && (!mPropertyBag || !mPropertyBag.xsrfToken)) {
					xhr.setRequestHeader("X-CSRF-Token", "fetch");
				}
				if ((sMethod === "POST" || sMethod === "PUT" || sMethod === "DELETE") && mPropertyBag && mPropertyBag.xsrfToken) {
					xhr.setRequestHeader("X-CSRF-Token", mPropertyBag.xsrfToken);
				}
				if (mPropertyBag && mPropertyBag.contentType) {
					xhr.setRequestHeader("Content-Type", mPropertyBag.contentType);
				}
				if (mPropertyBag && mPropertyBag.dataType) {
					xhr.responseType = mPropertyBag.dataType;
				}
				if (mPropertyBag && mPropertyBag.flexObjects) {
					xhr.send(mPropertyBag.flexObjects);
				} else {
					xhr.send();
				}
				xhr.onload = function() {
					if (xhr.status >= 200 && xhr.status < 400) {
						var oResult = {};
						var sContentType = xhr.getResponseHeader("Content-Type");
						if (sContentType && sContentType.startsWith("application/json")) {
							oResult.response = JSON.parse(xhr.response);
						}
						oResult.status = xhr.status;
						oResult.xsrfToken = xhr.getResponseHeader("X-CSRF-Token");
						resolve(oResult);
					} else {
						reject({
							status : xhr.status,
							message : xhr.statusText
						});
					}
				};
			});
		},

		/**
		 * Internal function to allow the connectors to generate a response object with all needed properties;
		 * Also usable for tests to generate these responses.
		 *
		 * @returns {object} Object containing an empty flex data response
		 */
		getEmptyFlexDataResponse: function () {
			return Object.assign({}, {
				changes: [],
				variants: [],
				variantChanges: [],
				variantDependentControlChanges: [],
				variantManagementChanges: []
			});
		}
	};
});