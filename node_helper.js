/* Magic Mirror
 * Module: Remote Control
 *
 * By Joseph Bethge
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const path = require("path");
const url = require("url");
const fs = require("fs");
const exec = require("child_process").exec;
const os = require("os");
const simpleGit = require("simple-git");
const bodyParser = require("body-parser");

var defaultModules = require(path.resolve(__dirname + "/../default/defaultmodules.js"));

Module = {
	configDefaults: {},
	register: function (name, moduleDefinition) {
		// console.log("Module config loaded: " + name);
		Module.configDefaults[name] = moduleDefinition.defaults;
	}
};

module.exports = NodeHelper.create({
	// Subclass start method.
	start: function() {
		var self = this;

		console.log("Starting node helper for: " + self.name);

		// load fall back translation
		self.loadTranslation("en");

		this.configOnHd = {};
		this.configData = {};

		this.waiting = [];

		this.template = "";
		this.modulesAvailable = {};
		this.modulesInstalled = [];

		fs.readFile(path.resolve(__dirname + "/remote.html"), function(err, data) {
			self.template = data.toString();
		});

		this.readModuleData();
		this.createRoutes();
		this.combineConfig();
	},

	combineConfig: function() {
		// function copied from MichMich (MIT)
		var defaults = require(__dirname + "/../../js/defaults.js");
		var configFilename = path.resolve(__dirname + "/../../config/config.js");
		try {
			fs.accessSync(configFilename, fs.F_OK);
			var c = require(configFilename);
			var config = Object.assign(defaults, c);
			this.configOnHd = config;
		} catch (e) {
			if (e.code == "ENOENT") {
				console.error("WARNING! Could not find config file. Please create one. Starting with default configuration.");
				this.configOnHd = defaults;
			} else if (e instanceof ReferenceError || e instanceof SyntaxError) {
				console.error("WARNING! Could not validate config file. Please correct syntax errors. Starting with default configuration.");
				this.configOnHd = defaults;
			} else {
				console.error("WARNING! Could not load config file. Starting with default configuration. Error found: " + e);
				this.configOnHd = defaults;
			}
		}
	},

	createRoutes: function() {
		var self = this;

		this.expressApp.use(bodyParser.json());

		this.expressApp.get("/remote.html", function(req, res) {
			if (self.template === "") {
				res.send(503);
			} else {
				self.callAfterUpdate(function () {
					res.contentType("text/html");
					var transformedData = self.fillTemplates(self.template);
					res.send(transformedData);
				});
			}
		});

		this.expressApp.get("/get", function(req, res) {
			var query = url.parse(req.url, true).query;

			self.answerGet(query, res);
		});
		this.expressApp.post("/post", function(req, res) {
			var query = url.parse(req.url, true).query;

			self.answerPost(query, req, res);
		});

		this.expressApp.get("/config-help.html", function(req, res) {
			var query = url.parse(req.url, true).query;

			self.answerConfigHelp(query, res);
		});

		this.expressApp.get("/remote", (req, res) => {
			var query = url.parse(req.url, true).query;

			if (query.action)
			{
				var result = self.executeQuery(query, res);
				if (result === true) {
					return;
				}
			}
			res.send({"status": "error", "reason": "unknown_command", "info": "original input: " + JSON.stringify(query)});
		});
	},

	capitalizeFirst: function(string) {
		return string.charAt(0).toUpperCase() + string.slice(1);
	},

	readModuleData: function() {
		var self = this;

		fs.readFile(path.resolve(__dirname + "/modules.json"), function(err, data) {
			self.modulesAvailable = JSON.parse(data.toString());

			for (var i = 0; i < defaultModules.length; i++) {
				self.modulesAvailable.push({
					longname: defaultModules[i],
					name: self.capitalizeFirst(defaultModules[i]),
					installed: true,
					author: "MichMich",
					desc: "",
					id: "MichMich/MagicMirror",
					url: "https://github.com/MichMich/MagicMirror/wiki/MagicMirror%C2%B2-Modules#default-modules"
				});
				var module = self.modulesAvailable[self.modulesAvailable.length - 1];
				var modulePath = path.resolve(__dirname + "/../default/" + defaultModules[i]);
				self.loadModuleDefaultConfig(module, modulePath);
			}

			// now check for installed modules
			fs.readdir(path.resolve(__dirname + "/.."), function(err, files) {
				for (var i = 0; i < files.length; i++) {
					if (files[i] !== "node_modules" && files[i] !== "default") {
						self.addModule(files[i]);
					}
				}
			});
		});
	},

	addModule: function(module) {
		var self = this;

		var modulePath = path.resolve(__dirname + "/../" + module);
		fs.stat(modulePath, function(err, stats) {
			if (stats.isDirectory()) {
				self.modulesInstalled.push(module);
				for (var i = 0; i < self.modulesAvailable.length; i++) {
					if (self.modulesAvailable[i].longname === module) {
						self.modulesAvailable[i].installed = true;
						self.loadModuleDefaultConfig(self.modulesAvailable[i], modulePath);
					}
				}
			}
		});
	},

	loadModuleDefaultConfig: function(module, modulePath) {
		// function copied from MichMich (MIT)
		var filename = path.resolve(modulePath + "/" + module.longname + ".js");
		try {
			fs.accessSync(filename, fs.F_OK);
			var jsfile = require(filename);
			module.configDefault = Module.configDefaults[module.longname];
		} catch (e) {
			if (e.code == "ENOENT") {
				console.error("ERROR! Could not find main module js file.");
			} else if (e instanceof ReferenceError || e instanceof SyntaxError) {
				console.error("ERROR! Could not validate main module js file.");
				console.error(e);
			} else {
				console.error("ERROR! Could not load main module js file. Error found: " + e);
			}
		}
	},

	answerConfigHelp: function(query, res) {
		if (defaultModules.indexOf(query.module) !== -1) {
			// default module
			var dir = path.resolve(__dirname + "/..");
			var git = simpleGit(dir);
			git.revparse(["HEAD"], function (error, result) {
				if (error) {
					console.log(error);
				}
				res.writeHead(302, {'Location': "https://github.com/MichMich/MagicMirror/tree/" + result.trim() + "/modules/default/" + query.module});
				res.end();
			});
			return;
		}
		var modulePath = path.resolve(__dirname + "/../" + query.module);
		var git = simpleGit(modulePath);
		git.getRemotes(true, function (error, result) {
			if (error) {
				console.log(error);
			}
			var baseUrl = result[0].refs.fetch;
			// replacements
			baseUrl = baseUrl.replace(".git", "").replace("github.com:","github.com/")
			// if cloned with ssh
			baseUrl = baseUrl.replace("git@", "https://");
			git.revparse(["HEAD"], function (error, result) {
				if (error) {
					console.log(error);
				}
				res.writeHead(302, {'Location': baseUrl + "/tree/" + result.trim()});
				res.end();
			});
		});
	},

	getConfig: function () {
		var config = this.configOnHd;
		for (var i = 0; i < config.modules.length; i++) {
			var current = config.modules[i];
			var defaults = Module.configDefaults[current.module];
			if (! ("config" in current)) {
				current.config = {};
			}
			if (!defaults) {
				defaults = {};
			}
			for (var d in defaults) {
				if (!(d in current.config)) {
					current.config[d] = defaults[d];
				}
			}
		}
		return config;
	},

	answerPost: function(query, req, res) {
		var self = this;

		if (query.data === "config") {
			var backupHistorySize = 5;
			var configPath = path.resolve("config/config.js");

			var best = -1;
			var bestTime = null;
			for (var i = backupHistorySize - 1; i > 0; i--) {
				var backupPath = path.resolve("config/config.js.backup" + i);
				try {
					var stats = fs.statSync(backupPath);
					if (best === -1 || stats.mtime < bestTime) {
						best = i;
						bestTime = stats.mtime;
					}
				} catch (e) {
					if (e.code === "ENOENT") {
						// does not exist yet
						best = i;
						bestTime = "0000-00-00T00:00:00Z";
					}
				}
			}
			if (best === -1) {
				// can not backup, panic!
				console.log("MMM-Remote-Control Error! Backing up config failed, not saving!");
				return;
			}
			var backupPath = path.resolve("config/config.js.backup" + best);

			var source = fs.createReadStream(configPath);
			var destination = fs.createWriteStream(backupPath);

			// back up last config
			source.pipe(destination, { end: false });
			source.on("end", function() {
				console.log("MMM-Remote-Control saved new config!");

				self.configOnHd = req.body;

				var header = "/*************** AUTO GENERATED BY REMOTE CONTROL MODULE ***************/\n\nvar config = \n";
				var footer = "\n\n/*************** DO NOT EDIT THE LINE BELOW ***************/\nif (typeof module !== 'undefined') {module.exports = config;}\n";

				fs.writeFile(configPath, header + JSON.stringify(req.body, null, 4) + footer);

				var text = JSON.stringify({"status": "success"});
				res.contentType("application/json");
				res.send(text);
			});
		}
	},

	answerGet: function(query, res) {
		var self = this;

		if (query.data === "modulesAvailable")
		{
			this.modulesAvailable.sort(function(a, b){return a.name.localeCompare(b.name);});
			var text = JSON.stringify(this.modulesAvailable);
			res.contentType("application/json");
			res.send(text);
		}
		if (query.data === "translations")
		{
			var text = JSON.stringify(this.translation);
			res.contentType("application/json");
			res.send(text);
		}
		if (query.data === "config")
		{
			var text = JSON.stringify(this.getConfig());
			res.contentType("application/json");
			res.send(text);
		}
		if (query.data === "defaultConfig")
		{
			var text = JSON.stringify(Module.configDefaults[query.module]);
			res.contentType("application/json");
			res.send(text);
		}
		if (query.data === "modules")
		{
			this.callAfterUpdate(function () {
				var text = JSON.stringify(self.configData.moduleData);
				res.contentType("application/json");
				res.send(text);
			});
		}
		if (query.data === "brightness")
		{
			this.callAfterUpdate(function () {
				var text = JSON.stringify(self.configData.brightness);
				res.contentType("application/json");
				res.send(text);
			});
		}
	},

	callAfterUpdate: function(callback, timeout) {
		if (timeout === undefined) {
			timeout = 3000;
		}

		var waitObject = {
			finished: false,
			run: function () {
				if (this.finished) {
					return;
				}
				this.finished = true;
				this.callback();
			},
			callback: callback
		}

		this.waiting.push(waitObject);
		this.sendSocketNotification("UPDATE");
		setTimeout(function() {
			waitObject.run();
		}, timeout);
	},
	
	executeQuery: function(query, res) {
		var self = this;
		var opts = {timeout: 8000};

		if (query.action === "SHUTDOWN")
		{
			exec("sudo shutdown -h now", opts, function(error, stdout, stderr){ self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === "REBOOT")
		{
			exec("sudo shutdown -r now", opts, function(error, stdout, stderr){ self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === "RESTART")
		{
			exec("pm2 restart mm", opts, function(error, stdout, stderr){ self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === "MONITORON")
		{
			exec("/opt/vc/bin/tvservice --preferred && sudo chvt 6 && sudo chvt 7", opts, function(error, stdout, stderr){ self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === "MONITOROFF")
		{
			exec("/opt/vc/bin/tvservice -o", opts, function(error, stdout, stderr){ self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === "HIDE" || query.action === "SHOW")
		{
			if (res) { res.send({"status": "success"}); }
			var payload = { module: query.module, useLockStrings: query.useLockStrings };
			if (query.action === "SHOW" && query.force === "true") {
				payload.force = true;
			}
			self.sendSocketNotification(query.action, payload);
			return true;
		}
		if (query.action === "BRIGHTNESS")
		{
			res.send({"status": "success"});
			self.sendSocketNotification(query.action, query.value);
			return true;
		}
		if (query.action === "SAVE")
		{
			if (res) { res.send({"status": "success"}); }
			self.callAfterUpdate(function () { self.saveDefaultSettings(); });
			return true;
		}
		if (query.action === "MODULE_DATA")
		{
			self.callAfterUpdate(function () {
				var text = JSON.stringify(self.configData);
				res.contentType("application/json");
				res.send(text);
			});
			return true;
		}
		if (query.action === "INSTALL")
		{
			self.installModule(query.url, res);
			return true;
		}
		return false;
	},

	installModule: function(url, res) {
		var self = this;

		res.contentType("application/json");

		simpleGit(path.resolve(__dirname + "/..")).clone(url, path.basename(url), function(error, result) {
			if (error) {
				console.log(error);
				res.send({"status": "error"});
			} else {
				var workDir = path.resolve(__dirname + "/../" + path.basename(url));
				exec("npm install", {cwd: workDir, timeout: 120000}, function(error, stdout, stderr)
				{
					if (error) {
						console.log(error);
						res.send({"status": "error"});
					} else {
						// success part
						self.readModuleData();
						res.send({"status": "success"});
					}
				});
			}
		});
	},
	
	checkForExecError: function(error, stdout, stderr, res) {
		if (error) {
			console.log(error);
			if (res) { res.send({"status": "error", "reason": "unknown", "info": error}); }
			return;
		}
		if (res) { res.send({"status": "success"}); }
	},

	translate: function(data) {
		for (var key in this.translation) {
			var pattern = "%%TRANSLATE:" + key + "%%";
			while (data.indexOf(pattern) > -1) {
				data = data.replace(pattern, this.translation[key]);
			}
		}
		return data;
	},

	saveDefaultSettings: function() {
		var text = JSON.stringify(this.configData);

		fs.writeFile(path.resolve(__dirname + "/settings.json"), text, function(err) {
			if (err) {
				throw err;
			}
		});
	},

	in: function(pattern, string) {
		return string.indexOf(pattern) !== -1;
	},

	loadDefaultSettings: function() {
		var self = this;

		fs.readFile(path.resolve(__dirname + "/settings.json"), function(err, data) {
			if (err) {
				if (self.in("no such file or directory", err.message)) {
					return;
				}
				console.log(err);
			} else {
				var data = JSON.parse(data.toString());
				self.sendSocketNotification("DEFAULT_SETTINGS", data);
			}
		});
	},

	format: function(string) {
		string = string.replace(/MMM-/ig, "");
		return string.charAt(0).toUpperCase() + string.slice(1);
	},

	fillTemplates: function(data) {
		data = this.translate(data);

		var brightness = 100;
		if (this.configData) {
			brightness = this.configData.brightness;
		}
		data = data.replace("%%REPLACE:BRIGHTNESS%%", brightness);

		return data;
	},

	loadTranslation: function(language) {
		var self = this;

		fs.readFile(path.resolve(__dirname + "/translations/" + language + ".json"), function(err, data) {
			if (err) {
				return;
			}
			else {
				self.translation = JSON.parse(data.toString());
			}
		});
	},

	getIpAddresses: function() {
		// module started, answer with current IP address
		var interfaces = os.networkInterfaces();
		var addresses = [];
		for (var k in interfaces) {
			for (var k2 in interfaces[k]) {
				var address = interfaces[k][k2];
				if (address.family === "IPv4" && !address.internal) {
					addresses.push(address.address);
				}
			}
		}
		return addresses;
	},

	socketNotificationReceived: function(notification, payload) {
		var self = this;

		if (notification === "CURRENT_STATUS")
		{
			this.configData = payload;
			for (var i = 0; i < this.waiting.length; i++) {
				var waitObject = this.waiting[i];

				waitObject.run();
			}
			this.waiting = [];
		}
		if (notification === "REQUEST_DEFAULT_SETTINGS")
		{
			// check if we have got saved default settings
			self.loadDefaultSettings();
		}
		if (notification === "LANG")
		{
			self.loadTranslation(payload);

			// module started, answer with current ip addresses
			self.sendSocketNotification("IP_ADDRESSES", self.getIpAddresses());
		}
		
		if (notification === "REMOTE_ACTION")
		{
			this.executeQuery(payload);
		}
		
	},
});
