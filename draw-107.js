

function to_hex(number)
{
	return number.toString(16).toUpperCase();
}

function base36 (coord)
{
	if (isNaN(coord) || coord < 0 || coord >= 36*36) {
	throw "bad coordinate " + coord;
	}
	var str = coord.toString (36);
	if (str.length == 1) {
		str = "0" + str;
	}
	return str;
}

function get_position(evt)
{
	evt = (evt) ?  evt : ((event) ? event : null);
	var left = 0;
	var top = 0;
	if (evt.pageX) {
	left = evt.pageX;
	top  = evt.pageY;
	} else if (typeof (document.documentElement.scrollLeft) != undefined) {
	left = evt.clientX + document.documentElement.scrollLeft;
	top  = evt.clientY + document.documentElement.scrollTop;
	} else  {
	left = evt.clientX + document.body.scrollLeft;
	top  = evt.clientY + document.body.scrollTop;
	}
	return {x : left, y : top}; 
}

function random_colour()
{
	var colour = new String();
	for (var i = 0; i < 3; i++) {
	colour = colour.concat (to_hex(Math.floor (Math.random() * 13)));
	}
	colour = '#' + colour;
	return colour;
}

function sendit (sendmessage, callback, cgi_override)
{
	var cgi;
	if (cgi_override) {
		cgi = cgi_override;
	} else {
		cgi = cgiscript;
	}
	if (! this.xmlhttp) {
		this.xmlhttp = new XMLHttpRequest()
	}
	if (this.xmlhttp.readyState == 1 ||
	this.xmlhttp.readyState == 2 ||
		this.xmlhttp.readyState == 3) {
	this.xmlhttp.abort (); 
	}
	this.xmlhttp.open ("POST", cgi, true);
	var self = this;
	this.xmlhttp.onreadystatechange = function() {
	if (self.xmlhttp.readyState == 4) {
			if (self.xmlhttp.status == 200) {
			callback (self.xmlhttp.responseText);
			}
		}
	}
	this.xmlhttp.send (sendmessage);
}

function supports_html5_storage() {
	try {
	return 'localStorage' in window && window['localStorage'] !== null;
	} catch (e) {
	return false;
	}
}

function value_from_bool (b)
{
	if (b) {
		return "1";
	} else {
		return "0";
	}
}

var hwcgi = 'hw-17.cgi';
var shape = '/shape-match/';
var nostroke = '/ppkanji/';
var backEnd = hwcgi;
var drawkanji;

function drawkanji_onload() {
	var loadInput = true;
	drawkanji = new DrawKanji(loadInput);
}
function drawCookie(pref_id) {
	return "draw_" + pref_id + "=";
}
var searchChoiceCookie = "searchChoice";
var defaultSearchChoice = "stroke-independent";
DrawKanji.prototype.clearFoundKanji = function() {
	clear(this.foundKanji);
}
function DrawKanji(load_input) {
	this.canvas = new DrawCanvas();
	this.foundKanji = getbyid("found-kanji");
	this.adjust_canvas_offsets();
	this.canvas_size = 300;
	this.active = false;
	this.tooManyStrokes = false;
	this.noStrokes = true;
	var self = this;

	this.canvas.element.onmouseup   = function(event) {
		self.mouseup(event);
	}
	this.canvas.element.onmousedown = function(event) {
		self.mousedown(event);
	}
	this.canvas.element.onmousemove = function(event) {
		self.mousemove(event);
	}

	this.canvas.element.ontouchstart = function(event) {
		self.touch_start(event);
	}
	this.canvas.element.ontouchmove = function(event) {
		self.touch_move(event);
	}
	this.canvas.element.ontouchend = function(event) {
		self.touch_end(event);
	}

	var make_image_button = document.getElementById("drawkanji-make-image-button");
	make_image_button.onclick = function(event) {
		self.makeImage();
	}

	var send_image = document.getElementById("drawkanji-send-image-button");
	send_image.onclick = function(event) {
		self.sendImage();
	}
	window.onresize = function() {
		self.adjust_canvas_offsets();
	}

	this.lookAheadBox = getbyid("look-ahead");
	this.lookAhead = this.lookAheadBox.checked;
	this.lookAheadBox.onclick = function(event) {
		self.toggleLookAhead();
	}
	this.numbers = getNumbers();
	this.multicoloured = getMulticoloured();
	this.save = getSave();
	this.colours = new Array();
	this.clearDrawing();
	this.storeOK = supports_html5_storage();
	this.drawOld = false;
	var href = window.location.href;
	if (typeof href !== 'undefined') {
		if (href.match(/draw-old/)) {
			defaultSearchChoice = "stroke-dependent";
			this.drawOld = true;
		}
	}
	this.getSearchChoiceCookie();
	if (this.searchChoice === null) {
		this.getSearchChoice();
	}
	if (this.searchChoice != defaultSearchChoice) {

		defaultElement = getbyid(defaultSearchChoice);
		defaultElement.checked = false;
		chosenElement = getbyid(this.searchChoice);
		chosenElement.checked = true;
		this.searchSet();
	}

	if (true || this.drawOld) {
		var clear_button = document.getElementById("drawkanji-clear-button");
		if (clear_button !== null) {
			clear_button.onclick = function(event) {
				self.clearAll();
			}
		}
		var back_button = document.getElementById("drawkanji-back-line-button");
		if (back_button !== null) {
			back_button.onclick = function(event) {
				self.backLine();
			}
		}
	}
	if (! this.drawOld) {
		this.revert_button = document.getElementById("revert-image");
		if (this.revert_button !== null) {
			this.revert_button.onclick = function(event) {
				self.backLine();
			}
		}
		this.clear_button_2 = document.getElementById("clear-image");
		if (this.clear_button_2 !== null) {
			this.clear_button_2.onclick = function(event) {
				self.clearAll();
			}
		}
	}
	if (! this.drawOld) {
		this.oldButtons = oldButtonsChecked();
		if (this.oldButtons) {
			this.revert_button.style.display = "none";
			this.clear_button_2.style.display = "none";
			var doc = getbyid("draw-old-controls");
			doc.style.display = "table-row";
		} else {
			this.revert_button.style.display = "inline-block";
			this.clear_button_2.style.display = "inline-block";
			var doc = getbyid("draw-old-controls");
			doc.style.display = "none";
		}
	}
	if (load_input) {
		this.load();
	}
	this.sendStroke();
}
DrawKanji.prototype.loadData = function(data) {
	var lines = data.split("\n");
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (line.match(/^\s*$/)) {
			break;
		}
		if (i == 0) {
			line = line.replace(/^[A-Za-z]+ /, '');
		}
		var points = line.length / 4;
		for (var j = 0; j < points; j++) {
			var x36 = line.substr(j * 4, 2);
			var y36 = line.substr(j * 4 + 2, 2);
			var x = parseInt(x36, 36);
			var y = parseInt(y36, 36);
			this.addPoint(x, y, false);
		}
		this.finishStroke();
	}
	this.drawAll();
}

DrawKanji.prototype.load_from_storage = function()
{
	var kanji = localStorage.kanji;
	if (! kanji) {
		return;
	}
	this.loadData(kanji);
	var reply = localStorage.reply;
	if (reply) {
		this.reply = JSON.parse(reply);
		this.showKanjiList();
	} else {
		this.sendStroke();
	}
}
DrawKanji.prototype.load = function() {
	if (! this.save) {
		return
	}
	if (! this.storeOK) {
		return;
	}
	this.load_from_storage();
}
DrawKanji.prototype.clearDrawing = function() {
	this.clear();
	this.clearFoundKanji();
	this.reply = undefined;
	this.tooManyStrokes = false;
	this.noStrokes = true;
	clearMessage();
}
DrawKanji.prototype.clearAll = function() {
	if (this.storeOK) {
		localStorage.removeItem('kanji');
		localStorage.removeItem('reply');
	}
	this.clearDrawing();
	if (! this.drawOld) {
		if (this.revert_button !== null) {
			this.revert_button.classList.add("disabled");
		}
		if (this.clear_button_2 !== null) {
			this.clear_button_2.classList.add("disabled");
		}
	}
}
DrawKanji.prototype.backLine = function() {
	clearMessage();
	if (this.stroke_num > 0) {
		this.sequence.pop();
		this.stroke_num--;
	}
	if (this.stroke_num > 0) {
		this.canvas.clear();
		this.drawAll();
		var ok = true;
				
		if (this.stroke_num >= 50) {
			userMessage(ml.too_many_strokes);
			ok = false;
			this.tooManyStrokes = true;
		} else {
			this.tooManyStrokes = false;
		}
		if (ok) {
			this.sendStroke();
		}
	} else {
		this.clearAll();
		this.noStrokes = true;
	}
}
DrawKanji.prototype.clear = function() {
	this.reset_brush();
	this.sequence = [];
	this.stroke_num = 0;
	this.canvas.clear();
}
DrawKanji.prototype.sendStroke = function() {

	if (this.stroke_num == 0) {
		return;
	}
	clearMessage();

	if (this.stroke_num == 1) {
		if (this.sequence[0].length == 1) {
			return;
		}
		var points_all_same = true;
		var seq0 = this.sequence[0];
		var x0 = seq0[0].x;
		var y0 = seq0[0].y;
		for (var i = 1; i < seq0.length; i++) {
			if (seq0[i].x != x0 || seq0[i].y != y0) {
				points_all_same = false;
				break;
			}

		}
		if (points_all_same) {
			return;
		}

	}

	var ok = true;
		
	if (this.stroke_num >= 50) {
		userMessage(ml.too_many_strokes);
		ok = false;
		this.tooManyStrokes = true;
	} else {
		this.tooManyStrokes = false;
	}
	if (! ok) {
		return;
	}
	var key;
	if (this.searchChoice == "stroke-dependent") {
		backEnd = hwcgi;
		key = "H";
		if (this.lookAhead) {
			key += "L";
		}
	} else if (this.searchChoice == "stroke-independent") {
		backEnd = nostroke;
		key = "h";
	} else if (this.searchChoice == "shape-match") {
		backEnd = shape;
		key = "H"
	} else {
		console.log("Unknown value for searchChoice " + this.searchChoice)
	}
	var r = this.makeMessage(key);
	var self = this;
	sendit(r, function(result) {
		self.result_callback(result)
	}, backEnd);
	if (this.storeOK) {
		localStorage.kanji = r;
	}
}

DrawKanji.prototype.setSearchChoiceCookie = function(choice) {
	set_cookie(searchChoiceCookie + "=" + this.searchChoice);
}

DrawKanji.prototype.getSearchChoiceCookie = function(choice) {
	this.searchChoice = get_cookie(searchChoiceCookie);
}
DrawKanji.prototype.searchSet = function() {
	if (this.searchChoice == "stroke-dependent") {
		this.ignoreStrokeOrder = false;
		this.lookAheadBox.disabled = false;
	} else if (this.searchChoice == "stroke-independent") {
		this.ignoreStrokeOrder = true;
		this.lookAheadBox.disabled = true;
	} else if (this.searchChoice == "shape-match") {
		this.ignoreStrokeOrder = true;
		this.lookAheadBox.disabled = true;
	} else {
	}
}

DrawKanji.prototype.setSearchChoice = function(choice) {
	this.searchChoice = choice;
	this.searchSet();
	this.setSearchChoiceCookie();
	this.clearFoundKanji();
}
DrawKanji.prototype.getSearchChoice = function() {
	var sdel = getbyid('stroke-dependent');
	var siel = getbyid('stroke-independent');
	var smel = getbyid('shape-match');
	if (sdel.checked) {
		this.searchChoice = 'stroke-dependent';
		return;
	}
	if (siel.checked) {
		this.searchChoice = 'stroke-independent';
		return;
	}
	if (smel.checked) {
		this.searchChoice = 'shape-match';
		return;
	}
	this.searchChoice = null;
	return;
}
function searchSelect(choice) {
	clearMessage();
	drawkanji.setSearchChoice(choice);
	drawkanji.canvas.clear();
	drawkanji.drawAll();
	drawkanji.sendStroke();
}
DrawKanji.prototype.finish_line = function() {
	if (this.point_num > 1) {
		this.finishStroke();
		this.sendStroke();
	} else {
		this.sequence[this.stroke_num].length = 0;
		this.reset_brush();
	}
}
DrawKanji.prototype.mouseup = function(event) {
	if (this.active) {
		this.mouse_trace(event);
		this.finish_line();
	}
}
DrawKanji.prototype.mousemove = function(event) {
	this.mouse_trace(event);
}

DrawKanji.prototype.start_line = function() {

	this.active = true;
}
DrawKanji.prototype.mousedown = function(event) {
	this.start_line();
	this.mouse_trace(event);
	if (event.preventDefault) {
		event.preventDefault();
	} else {
		event.returnValue = false;
	}
	return false;
}
DrawKanji.prototype.touch_end = function(event)
{
	if (this.active) {
		this.touch_trace(event);
		this.finish_line();
	}

	this.touching = false;
}
DrawKanji.prototype.touch_move = function(event) {
	this.touch_trace(event);
}
DrawKanji.prototype.touch_start = function(event) {
	this.start_line();

	this.touching = true;
	this.touch_trace(event);
}
DrawKanji.prototype.reset_brush = function() {
	this.active = false;
	this.point_num = 0;
}
DrawKanji.prototype.finishStroke = function() {
	this.annotate(this.stroke_num);
	this.stroke_num++;
	this.reset_brush();
	if (! this.drawOld) {
		if (this.revert_button !== null) {
			this.revert_button.classList.remove("disabled");
		}
		if (this.clear_button_2 !== null) {
			this.clear_button_2.classList.remove("disabled");
		}
	}
}
DrawKanji.prototype.drawAll = function() {
	var sq = this.sequence;
	for (var s = 0; s < this.stroke_num; s++) {
		var st = sq[s];
		this.canvas.start_line(st[0].x, st[0].y, this.colours[s]);
		this.annotate(s);
		for (var p = 1; p < st.length; p++) {
			this.canvas.draw_line(st[p].x, st[p].y);
		}
	}
}

let X_MIN = 10
let Y_MIN = 10
DrawKanji.prototype.annotate = function(stroke) {
	if (this.numbers != "always" && this.ignoreStrokeOrder) {
		return;
	}
	if (this.numbers == "never") {
		return;
	}
	var offsetlength = 15;
	var x;
	var y;
	var xoffset = offsetlength;
	var yoffset = offsetlength;
	var str = this.sequence[stroke];
	var gap = 1;
	x = str[0].x;
	y = str[0].y;
	
	if (str.length > 1) {
		if (str.length > 5) {
			gap = 5;
		}
		var sine   = str[gap].x - str[0].x;
		var cosine = str[gap].y - str[0].y;
		var length = Math.sqrt(sine * sine + cosine * cosine);
		if (length > 0) {
			sine /= length;
			cosine /= length;
			xoffset = - offsetlength * sine;
			yoffset = - offsetlength * cosine;
		}
	}
	x += xoffset;
	y += yoffset;
	if (x < X_MIN) {
		x = X_MIN;
	}
	if (y < Y_MIN) {
		y = Y_MIN;
	}
	if (x > this.canvas_size - X_MIN) {
		x = this.canvas_size - X_MIN;
	}
	if (y > this.canvas_size - Y_MIN) {
		y = this.canvas_size - Y_MIN;
	}
	this.canvas.draw_text(x, y, stroke + 1);
}

DrawKanji.prototype.addPoint = function(x, y, draw) {
	if (this.point_num == 0) {
		this.sequence[this.stroke_num] = new Array;
		var sq = this.sequence[this.stroke_num];
		sq[0] = {x:x, y:y};
		this.point_num++;
		var colour;
		if (this.multicoloured) {
			colour = random_colour();
		}
		else {
			colour = '#000';
		}
		this.colours[this.stroke_num] = colour;
		if (draw) {
			this.canvas.start_line(x, y, colour);
		}
	} else {
		var sq = this.sequence[this.stroke_num];
		var n = this.point_num;
		var prev = this.point_num - 1;
		if (x != sq[prev].x || y != sq[prev].y) {
			sq[n] = {x:x, y:y};
			this.point_num++;
			if (draw) {
				this.canvas.draw_line(x, y);
			}
		}
	}
}
DrawKanji.prototype.trace = function(pos) {

	if (
		pos.x <					2  ||
		pos.y <					2  ||
		pos.x > this.canvas_size - 4 ||
		pos.y > this.canvas_size - 4
	) {
		this.finish_line();
	} else {
		this.addPoint(Math.round(pos.x), Math.round(pos.y), true);
	}
}

function get_pos_canvas(canvas, event)
{
	var rect = canvas.getBoundingClientRect();
	return {
		x: event.clientX - rect.left,
		y: event.clientY - rect.top
	};
}

DrawKanji.prototype.mouse_trace = function(event) {

	if (! this.active) {
		return;
	}
	if (this.touching) {

		return;
	}
	var pos;
	if (this.canvas.is_canvas) {
		pos = get_pos_canvas(this.canvas.element, event);
	} else {	
		pos = this.canvas_adjust
(get_position(event));
	}
	this.trace(pos);
}

function get_touch_position(event) {
	var touchobj = event.changedTouches[0];
	var x = touchobj.pageX;
	var y = touchobj.pageY;
	return {"x" : x, "y" : y};
}

DrawKanji.prototype.touch_trace = function(event) {

	if (! this.active) {
		return;
	}
	var orig = get_touch_position(event);
	var pos = this.canvas_adjust(orig);
	this.trace(pos);
	event.preventDefault();
}
DrawKanji.prototype.makeMessage = function(c) {
	var r = c;
	r += " ";
	for (var i = 0; i < this.sequence.length; ++i) {
		for (var j = 0; j < this.sequence[i].length; ++j) {
			r += base36(this.sequence[i][j].x)
				+ "" + base36(this.sequence[i][j].y);
		}
		r += "\n";
	}
	r+= "\n\n";
	return r;
}  
DrawKanji.prototype.result_callback = function(reply) {
	this.reply = JSON.parse(reply);
	if (! this.reply) {
		return;
	}
	try {
		if (this.save) { 
			if (this.storeOK) {
				localStorage.reply = reply;
			}
		}
	}
	catch(err) {

	}
	if (this.reply.error !== undefined) {
		userMessage(ml[this.reply.error]);
		this.clearFoundKanji();
		return;
	}
	this.showKanjiList();
}
DrawKanji.prototype.createLink = function(href, parent, kanji, windowPref) {
	var anchor = create_text_node("button", parent, kanji);
	anchor.onclick = function() {
		var click = "C" + kanji.charCodeAt(0).toString(16);
		document.foundKanji["drawing"].value = drawkanji.makeMessage(click);
		document.foundKanji["kanji"].value = kanji;
		if (windowPref == "1") {
			document.foundKanji.target = "_blank";
		}
	}
}
DrawKanji.prototype.addKanji = function(kanji, windowPref) {
	create_link(this.foundKanji, kanji, windowPref, this.createLink);
	append_text(this.foundKanji, " ");
}
DrawKanji.prototype.showKanjiList = function() {
	if (! this.reply ||(!this.reply.results && !this.reply.scores)) {
		return;
	}
	var windowPreference = getWindowPreference();
	this.clearFoundKanji();
	for (var k in this.reply.results) {
		var kanji;
		kanji = this.reply.results[k];
		this.addKanji(kanji, windowPreference);
	}
}

DrawKanji.prototype.show_image = function(reply, image_window) {
	var parsed_reply = JSON.parse(reply);
	var id = parsed_reply.id;
	var location = ml.drawn_image_url;
	location += '?';
	location += 'id=' + id;
	image_window.location = location;
}

DrawKanji.prototype.colourString = function() {
	var colourString = "";
	if (this.colours.length > 0) {
		for (colour in this.colours) {
			colourString += this.colours[colour];
		}
		colourString = colourString.replace(/#/g, "");
		colourString = "#" + colourString + "\n";
	}
	return colourString;
}
DrawKanji.prototype.imageData = function() {
	var ok = true;
		
	if (this.stroke_num == 0) {
		userMessage(ml.no_image);
		ok = false;
		this.noStrokes = true;
	}
		
	if (this.stroke_num >= 50) {
		userMessage(ml.too_many_strokes);
		ok = false;
		this.tooManyStrokes = true;
	} else {
		this.tooManyStrokes = false;
	}
	if (! ok) {
		return;
	}
	var msg = "";
	msg += this.colourString();
	msg += this.makeMessage("P");
	return msg;
}
DrawKanji.prototype.makeImage = function() {
	var ok = true;
		
	if (this.stroke_num == 0) {
		userMessage(ml.no_image);
		ok = false;
		this.noStrokes = true;
	}
		
	if (this.stroke_num >= 50) {
		userMessage(ml.too_many_strokes);
		ok = false;
		this.tooManyStrokes = true;
	} else {
		this.tooManyStrokes = false;
	}
	if (! ok) {
		return;
	}
	var msg = this.imageData();
	var self = this;
	var image_window = window.open("", "kanji_image");
	sendit(msg,
				 function(reply) {
					 self.show_image(reply, image_window);
				 },
				 "make-image.cgi"
				);
}
DrawKanji.prototype.sendImage = function() {
	var ok = true;
		
	if (this.stroke_num == 0) {
		userMessage(ml.no_image);
		ok = false;
		this.noStrokes = true;
	}
		
	if (this.stroke_num >= 50) {
		userMessage(ml.too_many_strokes);
		ok = false;
		this.tooManyStrokes = true;
	} else {
		this.tooManyStrokes = false;
	}
	if (! ok) {
		return;
	}
	var palette = this.colourString();
	var imageData = this.makeMessage("");
	document.send_image.palette.value = palette;
	document.send_image.image_data.value = imageData;
	document.send_image.submit();
}

DrawKanji.prototype.toggleLookAhead = function() {
	this.lookAhead = this.lookAheadBox.checked;
	var v = value_from_bool(this.lookAhead);
	set_cookie(drawCookie("look-ahead") + v);
	this.sendStroke();
}
function getDrawPreference(pref_id) {
	var preference = get_cookie(drawCookie(pref_id));
	return preference;
}
function drawCookieSet(pref_id) {
	var cookie = getDrawPreference(pref_id);
	var control = getbyid(pref_id);
	if (cookie == "1") {
		control.checked = true;
	}
	else if (cookie == "0") {
		control.checked = false;
	}
}

DrawKanji.prototype.adjust_canvas_offsets = function() {
	var offset_left = 0;
	var offset_top  = 0;
	for (var o = this.canvas.element; o; o = o.offsetParent) {
		offset_left += o.offsetLeft;
		offset_top  += o.offsetTop;
	}
	this.canvas.offset_left = offset_left;
	this.canvas.offset_top  = offset_top;
	this.canvas.clear();
	this.drawAll();
}

DrawKanji.prototype.canvas_adjust = function(absolute) {
	var relative = new Object();
	relative.x = absolute.x - this.canvas.offset_left;
	relative.y = absolute.y - this.canvas.offset_top;
	return relative;
}
