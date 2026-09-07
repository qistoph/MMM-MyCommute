/* Magic Mirror
 * Module: mrx-work-traffic
 *
 * By Dominic Marx
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const moment = require("moment");

module.exports = NodeHelper.create({
	start: function () {
		console.log("====================== Starting node_helper for module [" + this.name + "]");
	},

	// subclass socketNotificationReceived
	socketNotificationReceived: function (notification, payload) {
		if (notification === "GOOGLE_TRAFFIC_GET") {
			//first data pull after new config
			this.getPredictions(payload);
		}
	},

	getPredictions: function(payload) {
		const self = this;
		let returned = 0;
		const predictions = [];

		payload.destinations.forEach(async function (dest, index) {
			const prediction = new Object({
				config: dest.config
			});

			try {
				const response = await fetch(dest.url);

				if (!response.ok) {
					prediction.error = true;
					console.log("Error getting traffic prediction: " + response.status);
					prediction.error_msg = "Error getting traffic prediction: " + response.status;
				} else {
					const data = await response.json();

					if (data.error_message) {
						console.log("MMM-MyCommute: " + data.error_message);
						prediction.error = true;
						prediction.error_msg = data.error_message;
					} else if (data.status !== "OK") {
						console.log("MMM-MyCommute: " + data.status);
						console.debug(data);
						prediction.error = true;
						prediction.error_msg = "data.status != OK: " + data.status;
					} else {
						const routeList = [];
						for (let i = 0; i < data.routes.length; i++) {
							const r = data.routes[i];
							const routeObj = new Object({
								summary: r.summary,
								time: r.legs[0].duration.value
							});

							if (r.legs[0].duration_in_traffic) {
								routeObj.timeInTraffic = r.legs[0].duration_in_traffic.value;
							}

							if (dest.config.mode && dest.config.mode === "transit") {
								const transitInfo = [];
								let gotFirstTransitLeg = false;

								for (let j = 0; j < r.legs[0].steps.length; j++) {
									const s = r.legs[0].steps[j];

									if (s.transit_details) {
										let arrivalTime = "";

										if (!gotFirstTransitLeg && dest.config.showNextVehicleDeparture) {
											gotFirstTransitLeg = true;
											arrivalTime = moment(s.transit_details.departure_time.value * 1000);
										}

										transitInfo.push({
											routeLabel: s.transit_details.line.short_name ? s.transit_details.line.short_name : s.transit_details.line.name,
											vehicle: s.transit_details.line.vehicle.type,
											arrivalTime: arrivalTime
										});
									}
								}

								routeObj.transitInfo = transitInfo;

								if (transitInfo.length <= 0) {
									const travelModes = r.legs[0].steps.map(s => s.travel_mode).join(", ");
									console.log("MMM-MyCommute: transit directrions does not contain any transits (" + travelModes + ")");
									prediction.error = true;
									prediction.error_msg = "MMM-MyCommute: transit directrions does not contain any transits (" + travelModes + ")";
								}
							}

							routeList.push(routeObj);
						}

						prediction.routes = routeList;
					}
				}
			} catch (error) {
				prediction.error = true;
				console.log("Error getting traffic prediction: " + error);
				prediction.error_msg = "Error getting traffic prediction: " + error;
			}

			predictions[index] = prediction;
			returned++;

			if (returned === payload.destinations.length) {
				self.sendSocketNotification("GOOGLE_TRAFFIC_RESPONSE" + payload.instanceId, predictions);
			}
		});
	}
});
