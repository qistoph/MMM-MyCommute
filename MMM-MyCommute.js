
/*********************************

	Magic Mirror Module:
	MMM-MyCommute
	By Jeff Clarke

	Fork of mrx-work-traffic
	By Dominic Marx
	https://github.com/domsen123/mrx-work-traffic

	MIT Licensed

*********************************/

/* global config, Module, Log, moment */

Module.register("MMM-MyCommute", {

	defaults: {
		apiKey: "",
		origin: "65 Front St W, Toronto, ON M5J 1E6",
		startTime: "00:00",
		endTime: "23:59",
		lang: config.language,
		hideDays: [],
		showSummary: true,
		showUpdated: true,
		colorCodeTravelTime: true,
		moderateTimeThreshold: 1.1,
		poorTimeThreshold: 1.3,
		nextTransitVehicleDepartureFormat: "[next at] h:mm a",
		travelTimeFormat: "m [min]",
		travelTimeFormatTrim: "left",
		pollFrequency: 10 * 60 * 1000, //every ten minutes, in milliseconds
		maxCalendarEvents: 0,
		maxCalendarTime: 24 * 60 * 60 * 1000,
		calendarOptions: [{mode: "driving"}],
		showArrivalTime: true,
		destinations: [
			{
				destination: "40 Bay St, Toronto, ON M5J 2X2",
				label: "Air Canada Centre",
				mode: "walking",
				time: null
			},
			{
				destination: "317 Dundas St W, Toronto, ON M5T 1G4",
				label: "Art Gallery of Ontario",
				mode: "transit",
				time: null
			},
			{
				destination: "55 Mill St, Toronto, ON M5A 3C4",
				label: "Distillery",
				mode: "bicycling",
				time: null
			},
			{
				destination: "6301 Silver Dart Dr, Mississauga, ON L5P 1B2",
				label: "Pearson Airport",
				time: null
			}
		]
	},

	getTranslations: function() {
		return {
			en: "translations/en.json",
			hu: "translations/hu.json",
			nl: "translations/nl.json",
			de: "translations/de.json"
		};
	},

	// Define required scripts.
	getScripts: function() {
		return ["moment.js", this.file("node_modules/moment-duration-format/lib/moment-duration-format.js")];
	},

	// Define required styles.
	getStyles: function () {
		return ["MMM-MyCommute.css", "font-awesome.css"];
	},

	travelModes: [
		"driving",
		"walking",
		"bicycling",
		"transit"
	],

	transitModes: [
		"bus",
		"subway",
		"train",
		"tram",
		"rail"
	],

	avoidOptions: [
		"tolls",
		"highways",
		"ferries",
		"indoor"
	],

	// Icons to use for each transportation mode
	symbols: {
		"driving":          "car",
		"walking":          "walk",
		"bicycling":        "bike",
		"transit":          "streetcar",
		"tram":             "streetcar",
		"bus":              "bus",
		"subway":           "subway",
		"train":            "train",
		"rail":             "train",
		"metro_rail":       "subway",
		"monorail":         "train",
		"heavy_rail":       "train",
		"commuter_train":   "train",
		"high_speed_train": "train",
		"intercity_bus":    "bus",
		"trolleybus":       "streetcar",
		"share_taxi":       "taxi",
		"ferry":            "boat",
		"cable_car":        "gondola",
		"gondola_lift":     "gondola",
		"funicular":        "gondola",
		"other":            "streetcar"
	},

	start: function() {
		Log.info("Starting module: " + this.name);

		this.predictions = [];
		this.loading = true;
		this.inWindow = true;
		this.isHidden = false;

		//start data poll
		this.getData();
		this.rescheduleInterval();
	},

	rescheduleInterval: function() {
		const self = this;
		if(this.interval !== null) {
			// Clear current interval, just in case
			clearInterval(this.interval);
		}

		this.interval = setInterval(function() {
			self.getData();
		}, this.config.pollFrequency);
	},

	suspended: false,

	suspend: function() {
		Log.log(this.name + " suspended");
		if(!this.suspended) {
			this.suspended = true;
			clearInterval(this.interval);
		}
	},

	resume: function() {
		Log.log(this.name + " resumed");
		if(this.suspended) {
			this.suspended = false;

			if(new Date() - this.lastUpdate > this.config.pollFrequency) {
				// Last refresh, before suspend, is too old. Update now
				this.getData();
			}
			this.rescheduleInterval();
		}
	},

	/*
		function isInWindow()

		@param start
			STRING display start time in 24 hour format e.g.: 06:00

		@param end
			STRING display end time in 24 hour format e.g.: 10:00

		@param hideDays
			ARRAY of numbers representing days of the week during which
			this tested item shall not be displayed.	Sun = 0, Sat = 6
			e.g.: [3,4] to hide the module on Wed & Thurs

		returns TRUE if current time is within start and end AND
		today is not in the list of days to hide.

	*/
	isInWindow: function(start, end, hideDays) {

		const now = moment();
		const startTimeSplit = start.split(":");
		const endTimeSplit = end.split(":");
		const startTime = moment().hour(startTimeSplit[0]).minute(startTimeSplit[1]);
		const endTime = moment().hour(endTimeSplit[0]).minute(endTimeSplit[1]);

		if (now.isBefore(startTime) || now.isAfter(endTime)) {
			return false;
		} else if ( hideDays.indexOf( now.day() ) !== -1) {
			return false;
		}
		return true;
	},

	appointmentDestinations: [],

	setAppointmentDestinations: function(payload) {
		this.appointmentDestinations = [];

		if ( this.config.calendarOptions.length === 0) {
			// No routing configs for calendar events
			// Skip looking those up then
			return;
		}

		for (let i=0; i<payload.length && this.appointmentDestinations.length<this.config.maxCalendarEvents; ++i) {
			const calendarEvent = payload[i];
			if ("location" in calendarEvent &&
					calendarEvent.location !== undefined &&
					calendarEvent.location !== false &&
					calendarEvent.startDate < (Date.now() + this.config.maxCalendarTime)
			) {
				this.appointmentDestinations.push.apply(this.appointmentDestinations,
					this.config.calendarOptions.map( calOpt => Object.assign({}, calOpt, {
						label: calendarEvent.title,
						destination: calendarEvent.location,
						arrival_time: calendarEvent.startDate / 1000,
						color: calendarEvent.color
					}))
				);
			}
		}

		// Make sure appointmentDestinations is not too long
		// Which could happend because of inner forEach on calendarOptions
		this.appointmentDestinations = this.appointmentDestinations.slice(0, this.config.maxCalendarEvents);
	},

	getDestinations: function() {
		return this.config.destinations.concat(this.appointmentDestinations);
	},

	lastUpdate: 0,

	getData: function() {
		Log.log(this.name + " refreshing routes");

		//only poll if in window
		if (this.isInWindow(this.config.startTime, this.config.endTime, this.config.hideDays)) {
			//build URLs
			let destinationGetInfo = [];
			const destinations = this.getDestinations();
			for(let i = 0; i < destinations.length; i++) {
				const d = destinations[i];

				const destStartTime = d.startTime || "00:00";
				const destEndTime = d.endTime || "23:59";
				const destHideDays = d.hideDays || [];

				if (this.isInWindow(destStartTime, destEndTime, destHideDays)) {
					const url = "https://maps.googleapis.com/maps/api/directions/json" + this.getParams(d);
					destinationGetInfo.push({ url:url, config: d});
				}
			}
			this.inWindow = true;

			if (destinationGetInfo.length > 0) {
				this.sendSocketNotification("GOOGLE_TRAFFIC_GET", {destinations: destinationGetInfo, instanceId: this.identifier});
			} else {
				this.hide(1000, {lockString: this.identifier});
				this.inWindow = false;
				this.isHidden = true;
			}

			this.lastUpdate = new Date();
		} else {
			this.hide(1000, {lockString: this.identifier});
			this.inWindow = false;
			this.isHidden = true;
		}
	},

	getParams: function(dest) {

		let params = "?";
		params += "origin=" + encodeURIComponent(dest.origin || this.config.origin);
		params += "&destination=" + encodeURIComponent(dest.destination);
		params += "&key=" + this.config.apiKey;
		params += "&language=" + this.config.lang;

		//travel mode
		let mode = "driving";
		if (dest.mode && this.travelModes.indexOf(dest.mode) !== -1) {
			mode = dest.mode;
		}
		params += "&mode=" + mode;

		//transit mode if travelMode = "transit"
		if (mode === "transit" && dest.transitMode) {
			const tModes = dest.transitMode.split("|");
			let sanitizedTransitModes = "";
			for (let i = 0; i < tModes.length; i++) {
				if (this.transitModes.indexOf(tModes[i]) !== -1) {
					sanitizedTransitModes += (sanitizedTransitModes === "" ? tModes[i] : "|" + tModes[i]);
				}
			}
			if (sanitizedTransitModes.length > 0) {
				params += "&transit_mode=" + sanitizedTransitModes;
			}
		}

		if (dest.waypoints) {
			const waypoints = dest.waypoints.split("|");
			for (let i = 0; i < waypoints.length; i++) {
				waypoints[i] = "via:" + encodeURIComponent(waypoints[i]);
			}
			params += "&waypoints=" + waypoints.join("|");
		}

		//avoid
		if (dest.avoid) {
			const a = dest.avoid.split("|");
			let sanitizedAvoidOptions = "";
			for (let i = 0; i < a.length; i++) {
				if (this.avoidOptions.indexOf(a[i]) !== -1) {
					sanitizedAvoidOptions += (sanitizedAvoidOptions === "" ? a[i] : "|" + a[i]);
				}
			}
			if (sanitizedAvoidOptions.length > 0) {
				params += "&avoid=" + sanitizedAvoidOptions;
			}
		}
		if (dest.alternatives === true) {
			params += "&alternatives=true";
		}

		if (dest.arrival_time) {
			params += "&arrival_time=" + dest.arrival_time;
		} else {
			params += "&departure_time=now";	//needed for time based on traffic conditions
		}

		return params;

	},

	svgIconFactory: function(glyph) {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttributeNS(null, "class", "transit-mode-icon");

		const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
		use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "modules/MMM-MyCommute/icon_sprite.svg#" + glyph);
		svg.appendChild(use);
		return(svg);
	},

	formatTime: function(time, timeInTraffic) {
		const timeEl = document.createElement("span");
		timeEl.classList.add("travel-time");
		let now = moment();
		if (timeInTraffic != null) {
			if(this.config.showArrivalTime) {
				timeEl.innerHTML = moment.duration(Number(timeInTraffic), "seconds").format(this.config.travelTimeFormat, {trim: this.config.travelTimeFormatTrim}) + " - " + now.add(Number(timeInTraffic), "seconds").format("HH:mm");
			}
			else {
				timeEl.innerHTML = moment.duration(Number(timeInTraffic), "seconds").format(this.config.travelTimeFormat, {trim: this.config.travelTimeFormatTrim});
			}
			const variance = timeInTraffic / time;
			if (this.config.colorCodeTravelTime) {
				if (variance > this.config.poorTimeThreshold) {
					timeEl.classList.add("status-poor");
				} else if (variance > this.config.moderateTimeThreshold) {
					timeEl.classList.add("status-moderate");
				} else {
					timeEl.classList.add("status-good");
				}
			}
		} else {
			if(this.config.showArrivalTime) {
				timeEl.innerHTML = moment.duration(Number(time), "seconds").format(this.config.travelTimeFormat, {trim: this.config.travelTimeFormatTrim}) + " - " + now.add(Number(time), "seconds").format("HH:mm");
			}
			else {
				timeEl.innerHTML = moment.duration(Number(time), "seconds").format(this.config.travelTimeFormat, {trim: this.config.travelTimeFormatTrim});
			}
			timeEl.classList.add("status-good");
		}
		return timeEl;
	},

	getTransitIcon: function(dest, route) {
		let transitIcon;
		if (dest.transitMode) {
			transitIcon = dest.transitMode.split("|")[0];
			if (this.symbols[transitIcon] != null) {
				transitIcon = this.symbols[transitIcon];
			} else {
				transitIcon = this.symbols[route.transitInfo[0].vehicle.toLowerCase()];
			}
		} else {
			transitIcon = this.symbols[route.transitInfo[0].vehicle.toLowerCase()];
		}

		return transitIcon;
	},

	buildTransitSummary: function(transitInfo, summaryContainer) {

		for (let i = 0; i < transitInfo.length; i++) {
			const transitLeg = document.createElement("span");
			transitLeg.classList.add("transit-leg");
			transitLeg.appendChild(this.svgIconFactory(this.symbols[transitInfo[i].vehicle.toLowerCase()]));

			const routeNumber = document.createElement("span");
			routeNumber.innerHTML = transitInfo[i].routeLabel;

			if (transitInfo[i].arrivalTime) {
				routeNumber.innerHTML = routeNumber.innerHTML + " (" + moment(transitInfo[i].arrivalTime).format(this.config.nextTransitVehicleDepartureFormat) + ")";
			}

			transitLeg.appendChild(routeNumber);
			summaryContainer.appendChild(transitLeg);
		}
	},

	getDom: function() {
		const wrapper = document.createElement("div");
		if (this.loading) {
			const loading = document.createElement("div");
			loading.innerHTML = this.translate("LOADING");
			loading.className = "dimmed light small";
			wrapper.appendChild(loading);
			return wrapper;
		}

		const destinations = this.getDestinations();
		for (let i = 0; i < this.predictions.length; i++) {
			const p = this.predictions[i];
			const row = document.createElement("div");
			row.classList.add("row");
			const destination = document.createElement("span");
			destination.className = "destination-label bright";
			destination.innerHTML = p.config.label;
			row.appendChild(destination);

			const icon = document.createElement("span");
			icon.className = "transit-mode bright";
			let symbolIcon = "car";
			if (destinations[i].color) {
				icon.setAttribute("style", "color:" + p.config.color);
			}

			if (p.config.mode && this.symbols[p.config.mode]) {
				symbolIcon = this.symbols[p.config.mode];
			}

			//different rendering for single route vs multiple
			if (p.error) {
				//no routes available.	display an error instead.
				const errorTxt = document.createElement("span");
				errorTxt.classList.add("route-error");
				errorTxt.innerHTML = "Error: " + p.error_msg;
				row.appendChild(errorTxt);
				console.error("MMM-MyCommute error: " + p.error_msg, "Config:", p.config);

			} else if (p.routes.length === 1 || !this.config.showSummary) {
				let r = p.routes[0];

				//summary?
				if (this.config.showSummary) {
					var singleSummary = document.createElement("div");
					singleSummary.classList.add("route-summary");
					if (r.transitInfo) {
						symbolIcon = this.getTransitIcon(p.config,r);
						this.buildTransitSummary(r.transitInfo, singleSummary);
					} else {
						singleSummary.innerHTML = r.summary;
					}
					singleSummary.appendChild(this.formatTime(r.time, r.timeInTraffic));
					row.appendChild(singleSummary);
				}
				else {
					row.appendChild(this.formatTime(r.time, r.timeInTraffic));
				}
			} else {
				row.classList.add("with-multiple-routes");
				for (let j = 0; j < p.routes.length; j++) {
					const routeSummaryOuter = document.createElement("div");
					routeSummaryOuter.classList.add("route-summary-outer");
					let r = p.routes[j];

					var multiSummary = document.createElement("div");
					multiSummary.classList.add("route-summary");
					if (r.transitInfo) {
						symbolIcon = this.getTransitIcon(p.config,r);
						this.buildTransitSummary(r.transitInfo, multiSummary);
					} else {
						multiSummary.innerHTML = r.summary;
					}
					routeSummaryOuter.appendChild(multiSummary);
					routeSummaryOuter.appendChild(this.formatTime(r.time, r.timeInTraffic));
					row.appendChild(routeSummaryOuter);
				}
			}
			const svg = this.svgIconFactory(symbolIcon);
			icon.appendChild(svg);
			row.appendChild(icon);
			wrapper.appendChild(row);
		}

		if(this.config.showUpdated) {
			const updatedRow = document.createElement("div");
			updatedRow.classList.add("light");
			updatedRow.classList.add("xsmall");
			updatedRow.innerHTML = this.translate("LAST_REFRESHED") + this.lastUpdated.format("HH:mm");
			wrapper.appendChild(updatedRow);
		}
		return wrapper;
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === "GOOGLE_TRAFFIC_RESPONSE" + this.identifier) {
			this.predictions = payload;
			this.lastUpdated = moment();
			if (this.loading) {
				this.loading = false;
				if (this.isHidden) {
					this.updateDom();
					this.show(1000, { lockString: this.identifier });
				} else {
					this.updateDom(1000);
				}
			} else {
				this.updateDom();
				if ( this.isHidden ) {
					this.show(1000, { lockString: this.identifier });
				}
			}
			this.isHidden = false;
		}
	},

	notificationReceived: function(notification, payload) {
		if (notification === "DOM_OBJECTS_CREATED" && !this.inWindow) {
			this.hide(0, { lockString: this.identifier });
			this.isHidden = true;
		} else if (notification === "CALENDAR_EVENTS") {
			this.setAppointmentDestinations(payload);
		}
	}
});
