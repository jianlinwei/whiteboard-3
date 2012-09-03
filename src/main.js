var Whiteboard = (function () {
	'use strict';

	var extend = function (toObj, fromObj) {
		toObj = toObj || {};
		Object.keys(fromObj).forEach(function (key) {
			if (!(key in toObj)) {
				toObj[key] = fromObj[key];
			}
		});
		return toObj;
	};

	var Whiteboard = function (cfg) {
		this.cfg = extend(cfg, this.Defaults);
		return this.init();
	};

	Whiteboard.prototype.Defaults = {
		renderTo: 'body',
		markerRadius: 8,
		eraserRadius: 30,
		markerColor: '#000'
	};

	Whiteboard.prototype.init = function () {
		if (this.cfg.observable) {
			this.observable = this.cfg.observable;
		}

		this.drawer = new Whiteboard.Drawer(this.cfg);

		this.id = this.cfg.id;
		this.userId = this.cfg.userId ||
			Math.random().toString(32).substring(2);

		this.figures = {};

		this.createTools();
		this.bindSocket();
		this.bindInput();
	};

	Whiteboard.prototype.createTools = function () {
		this.tools = {
			marker: {
				type: 'marker',
				color: this.cfg.markerColor,
				radius: this.cfg.markerRadius
			},

			eraser: {
				type: 'eraser',
				radius: this.cfg.eraserRadius
			}
		};
	};

	Whiteboard.prototype.getHash = function () {
		return document.location.hash.replace(/^#/, '');
	};

	Whiteboard.prototype.bindSocket = function () {
		if (this.cfg.socket) {
			this.socket = this.cfg.socket;
		} else if (this.cfg.socketHost) {
			this.socket = io.connect(this.cfg.socketHost);
		} else {
			return;
		}

		this._onMessage = this.onMessage.bind(this);
		this.socket.on('message', this._onMessage);

		this._onConnect = this.onConnect.bind(this);
		if (this.socket.socket.connected) {
			this.onConnect();
		} else {
			this.socket.once('connect', this._onConnect, this);
		}
	};

	Whiteboard.prototype.onConnect = function () {
		var message = {
			queue: this.id || '',
			userId: this.userId
		};

		console.log('SOCKET SEND SUBSCRIBE', message);

		this.socket.send([
			this.cfg.subscribe,
			JSON.stringify(message)
		].join(':'));
	};

	Whiteboard.prototype.onMessage = function (message) {
		console.log('SOCKET RECEIVE', message);

		if (message.wbId != null && this.id != message.wbId) {
			this.id = message.wbId;
			this.observable.fireEvent('id', this.id);
		}

		if (message.userId == this.userId) {
			if (message.snapshot) {
				this.drawer.drawPng(message.snapshot);
			}
		} else {
			if (message.width || message.height) {
				this.drawer.resize(message.width, message.height);
			}

			if (message.figure) {
				this.drawer.drawFigure(message.figure);
			}
		}
	};

	Whiteboard.prototype.unbindSocket = function () {
		if (this.socket) {
			this.socket.removeListener('connect', this._onConnect);
			this.socket.removeListener('message', this._onMessage);
		}
	};

	Whiteboard.prototype.sendFigure = function (figure) {
		if (null == this.socket) { return; }
		if (null == this.id) { return; }

		var message = {
			queue: this.id,
			data: {
				wbId: this.id,
				userId: this.userId,
				width: this.drawer.width,
				height: this.drawer.height,
				figure: figure
			}
		};

		console.log('SOCKET SEND FIGURE', message);

		this.socket.send([
			this.cfg.publish,
			JSON.stringify(message)
		].join(':'));
	};

	Whiteboard.prototype.bindInput = function () {
		var my = this;

		var container = this.drawer.container;

		// mouse
		container.addEventListener('mousedown', function (e) {
			return my.onMouseDown(e);
		}, false);

		container.addEventListener('mousemove', function (e) {
			return my.onMouseMove(e);
		}, false);

		document.addEventListener('mouseup', function (e) {
			return my.onMouseUp(e);
		}, false);

		// multitouch
		container.addEventListener('touchstart', function (e) {
			return my.onTouchStart(e);
		}, false);

		container.addEventListener('touchmove', function (e) {
			return my.onTouchMove(e);
		}, false);

		document.addEventListener('touchend', function (e) {
			return my.onTouchEnd(e);
		}, false);

		// hashchange
		window.addEventListener('hashchange', function (e) {
			return my.onHashChange(e);
		}, false);
	};


	Whiteboard.prototype.onTouchStart = function (e) {
		if (null == this.id) { return; }

		this.drawer.updateContPos();

		var touches = e.targetTouches;
		for (var i = 0, len = touches.length; i < len; i += 1) {
			var finger = touches[i];
			this.figures[finger.identifier] =
				this.drawer.createFigure(this.tools.marker);
		}
	};

	Whiteboard.prototype.onTouchEnd = function (e) {
		var touches = e.changedTouches;
		for (var i = 0, len = touches.length; i < len; i += 1) {
			var finger = touches[i];
			this.onEndFigure(finger.identifier);
		}
	};

	Whiteboard.prototype.onTouchMove = function (e) {
		// FIXME: temporarily disallow drawing with many fingers
		if (e.touches.length > 1) { return; }

		e.preventDefault();

		var touches = e.changedTouches;

		for (var i = 0, len = touches.length; i < len; i += 1) {
			var finger = touches[i];
			var figure = this.figures[finger.identifier];

			if (figure) {
				var x = finger.pageX;
				var y = finger.pageY;
				this.drawLine(figure, x, y);
			}
		}
	};

	Whiteboard.prototype.onMouseDown = function (e) {
		if (null == this.id) { return; }

		if (1 != e.which) { return; }

		this.isMouseDown = true;

		this.drawer.updateContPos();

		this.figures.mouse = this.drawer.createFigure(
			this.tools[e.shiftKey ? 'eraser' : 'marker']
		);

		this.onMouseMove(e);
	};

	Whiteboard.prototype.onMouseUp = function (e) {
		if (1 != e.which) { return; }

		e.preventDefault();

		if (!this.isMouseDown) { return; }

		this.isMouseDown = false;

		this.onEndFigure('mouse');
	};

	Whiteboard.prototype.onMouseMove = function (e) {
		e.preventDefault();

		if (!this.isMouseDown) { return; }

		var figure = this.figures.mouse;

		this.drawLine(figure, e.pageX, e.pageY);
	};

	Whiteboard.prototype.drawLine = function (figure, x, y) {
		var relX = x - this.drawer.contPos.left;
		var relY = y - this.drawer.contPos.top;

		figure.push([ relX, relY ]);

		this.drawer.drawFigure(figure, 2);
	};

	Whiteboard.prototype.onEndFigure = function (id) {
		var figure = this.figures[id];

		if (figure) {
			this.observable.fireEvent('figure', figure);

			this.sendFigure(figure);
			delete this.figures[id];
		}
	};

	Whiteboard.prototype.observable = {
		fireEvent: function () {},
		on: function () {}
	};

	return Whiteboard;
}());
