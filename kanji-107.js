
function create_node (type,parent)
{
	var new_node = document.createElement (type);
	parent.appendChild (new_node);
	return new_node;
}

function append_text (parent,text)
{
	var text_node = document.createTextNode (text);
	parent.appendChild(text_node);
}

function clear (o)
{
	while (o.firstChild)
		o.removeChild(o.firstChild);
}

function create_text_node (type,parent,text)
{
	var new_node = create_node (type,parent);
	var text_node = document.createTextNode (text);
	new_node.appendChild(text_node);
	return new_node;
}

function delete_cookie (name) {
	document.cookie = name + '=; expires=Thu, 01-Jan-70 00:00:01 GMT;';
}

function get_cookie(cookie_string) {
	if (!document.cookie) {
		return null;
	}
	var c_start=document.cookie.indexOf(cookie_string);
	if (c_start == -1) {
		return null;
	}
	c_start += cookie_string.length;
	var c_end = document.cookie.indexOf(";", c_start);
	if (c_end == -1) {
		c_end = document.cookie.length;
	}
	var cookie = document.cookie.substring(c_start, c_end);
	if (cookie.charAt(0) == "=") {
		cookie = cookie.substring(1)
	}
	return cookie;
}

function getbyid (id)
{
	var element = document.getElementById (id);
	return element;
}

function gup (name)
{
	name = name.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
	var regexS = "[\\?&]"+name+"=([^&#]*)";
	var regex = new RegExp(regexS, "g");
	var values = new Array();
	while (1) {
		var results = regex.exec(window.location.href);
		if (results == null) {
			if (values.length == 0) {
			return "";
			} else if (values.length == 1) {
				return values[0];
			} else {
				return values;
			}
		} else {
		var value = decodeURIComponent(results[1]);
		values.push(value);
		}
	}
}

function sendget (sendmessage, callback, cgi_override)
{
	var cgi;
	if (cgi_override) {
		cgi = cgi_override;
	} else {
		cgi = cgiscript;
	}
	if (! this.xmlhttp) {
		this.xmlhttp = new XMLHttpRequest ();
	}
	if (this.xmlhttp.readyState == 1 ||
	this.xmlhttp.readyState == 2 ||
		this.xmlhttp.readyState == 3) {
	this.xmlhttp.abort (); 
	}
	this.xmlhttp.open ("GET", cgi + "?" + sendmessage, true);
	var self = this;
	this.xmlhttp.onreadystatechange = function() {
	if (self.xmlhttp.readyState == 4) {
			if (self.xmlhttp.status == 200) {
			callback (self.xmlhttp.responseText);
			}
		}
	}
	this.xmlhttp.send ();
}

function set_cookie (value)
{
	var date_now = new Date();
	var one_year_later = new Date (date_now.getTime() + 31536000000);
	var expiry_date = one_year_later.toGMTString();
	document.cookie = value + ';expires=' + expiry_date + ';';
}
var cgiscript = "minidic-1.cgi";

function getMsgBox() {
	return getbyid("msg-box");
}

function getMsgCon() {
	return getbyid("msg-con");
}

function setMsgBoxDisplay(msgBox, v) {
	msgBox.style.display = v;
}

function setMsgContent(msgCon, v) {
	msgCon.innerHTML = v;
}
function userMessage(msg) {
	var msgBox = getMsgBox();
	if (msgBox === null) {
		return;
	}
	var msgCon = getMsgCon();
	if (msgCon === null) {
		return;
	}
	setMsgContent(msgCon, msg);
	setMsgBoxDisplay(msgBox, "block");
}
function clearMessage() {
	var msgBox = getMsgBox();
	if (msgBox === null) {
		return;
	}
	var msgCon = getMsgCon();
	if (msgCon === null) {
		return;
	}
	setMsgContent(msgCon, "");
	setMsgBoxDisplay(msgBox, "none");
}
function KanjiResults(kanji, n_kanji) {
	this.found_kanji = getbyid("found-kanji");
	this.down_button = getbyid("down-button");
	this.up_button = getbyid("up-button");
	this.resetButton = resultsReset();
	this.kanji = kanji.match(/\d+|./g);
	this.n_kanji = n_kanji;
	var self = this;
	this.down_button.onclick = function() { self.go_down(); }
	this.up_button.onclick = function() { self.go_up(); }
	if (typeof(results_table_columns) == "undefined") {
		this.columns = 10;
	}
	else {
		this.columns = results_table_columns;
	}
	if (typeof(max_kanji) == "undefined") {
		this.max_cells = 100;
	}
	else {
		this.max_cells = max_kanji;
	}
	this.silly_amount = 20;
	this.offset = 0;
	this.scroll	= 0;
	this.scrolled_numbers = 0;

	this.numbers = new Array();

	var max_numbers = Math.floor(n_kanji / this.max_cells);

	for (var j = 0; j <= max_numbers; j++) {
		this.numbers[j] = 0;
	}
	for (var i = 0; i < n_kanji; i++) {
		var j = Math.floor(i / this.max_cells);
		if (this.kanji[i].match(/^\d+$/)) {
			this.numbers[j]++;
		}
	}
}

KanjiResults.prototype.adjust_scroll = function(chng) {
	if (this.scroll + chng < 0) {
		return;
	}
	this.scroll += chng;
	this.offset = this.offset + chng * this.max_cells;
	this.scrolled_numbers = 0;
	for (var i = 0; i < this.scroll; i++) {
		this.scrolled_numbers += this.numbers[i];
	}
}

KanjiResults.prototype.go_down = function() {
	this.adjust_scroll(+1);
	this.show();
}

KanjiResults.prototype.go_up = function() {
	this.adjust_scroll(-1);
	this.show();
}

KanjiResults.prototype.clear_found_kanji = function() {
	clear(this.found_kanji);
}

KanjiResults.prototype.clear_down_button = function() {
	clear(this.down_button);
}

KanjiResults.prototype.clear_up_button = function() {
	clear(this.up_button);
}
KanjiResults.prototype.clear = function() {
	this.clear_found_kanji();
	this.clear_down_button();
	this.clear_up_button();
}

KanjiResults.prototype.overflow_button = function()
{
	var remaining = this.n_kanji - this.max_cells - this.offset;
	if (this.offset == 0 && remaining <= 0) {
		return;
	}
	this.clear_down_button();

	var above = this.offset - this.scrolled_numbers;
	if (! this.silly_remaining && remaining > 0) {
		var below = this.n_kanji - (above + this.max_cells - this.numbers[this.scroll]);
		var downbutton = create_text_node("a", this.down_button,
												"▼ " + below + " more");
	}
	this.clear_up_button();
	if (this.offset != 0) {
		var upbutton = create_text_node("a", this.up_button,
											  "▲ " + above + " more");
	} else {
		if (!this.silly_remaining && remaining > 0) {
			upbutton = create_text_node ("a", this.up_button,
											   "▲ 0 more");
			upbutton.className= "deadupbutton";
		}
	}
}

KanjiResults.prototype.show = function() {
	this.clear();
	var max = this.kanji.length;
	var remaining = 0;
	this.silly_remaining = false;
	if (this.offset + this.max_cells < max) {
		max = this.offset + this.max_cells;
		remaining = this.kanji.length - max;
		if (remaining < this.silly_amount) {
			max = this.kanji.length;
			this.silly_remaining = true;
		}
	}
	var displayed_kanji = 0;
	var table = create_node("table", this.found_kanji);
	var tbody = create_node("tbody", table);
	var tr;
	var windowPreference = getWindowPreference();
	for (var k = this.offset; k < max; k++) {
		if ((k - this.offset) % this.columns == 0)
			tr = create_node("tr", tbody);
		var td = create_node("td", tr);
		if (this.kanji[k].match(/^\d+$/)) {
			append_text(td, this.kanji[k]);
			td.className = "number";
		} else {
			create_link(td, this.kanji[k], windowPreference, redirectLink);
			displayed_kanji++;
		}
	}
	if (k >= this.max_cells + this.offset || this.offset > 0) {
		this.overflow_button(this.silly_remaining);
	}
	this.resetButton.disabled = false;
}

var link_cookie_string = "link";
function setLinkCookie(link) {
	var y = new Date().getFullYear()
	var oneYearLater = new Date(new Date().setFullYear(y + 1))
	var expiryDate = oneYearLater.toGMTString();
	cookie = link_cookie_string + "=" + link + '; path=/; expires=' + expiryDate + ';';
	document.cookie = cookie; 
}
function deleteLinkCookie() {
	cookie = link_cookie_string + "=" + '; path=/; expires=Thu, 01-Jan-70 00:00:01 GMT;';
	document.cookie = cookie; 
}
function setLinkPreference(link) {
	setLinkCookie(link);
}

function getLinkPreference() {
	return get_cookie(link_cookie_string);
}
function clearLinkPreference() {
	deleteLinkCookie();

	var ele = document.getElementsByName("link-to");
	for (var i = 0; i < ele.length; i++) {
		if (ele[i].id == ml.default_link) { 
			ele[i].checked = true;
		} else {
			ele[i].checked = false;
		}
	}
}

var window_cookie_string = "newwindow=";
function setWindowPreference() {
	var newwindow = getbyid("nwc");
	var value;
	if (newwindow.checked) {
		value = 1;
	} else {
		value = 0;
	}
	set_cookie(window_cookie_string + value);
}
function getWindowPreference() {
	var nwindow = get_cookie(window_cookie_string);
	return nwindow;
}

var use_input_box_cookie = "uib=";

function show_input_box() {
	var wbd = getbyid("input-box-div");
	wbd.style.display = "block";
}

function hide_input_box() {
	var wbd = getbyid("input-box-div");
	wbd.style.display = "none";
}

function set_input_box_preference(e) {
	var inbox_el = getbyid("inbox");
	var preference = 0;
	if (inbox_el.checked) {
		preference = 1;
		show_input_box();
	} else {

		clear_input_box();
		hide_input_box();
	}
	set_cookie(use_input_box_cookie + preference);
}

function get_input_box_preference()
{
	var preference = get_cookie(use_input_box_cookie)
	if (preference == 1) {
		return true;
	}
	return false;
}

var use_input_box = false;

var input_box_cookie = "wbv=";

function checkInputBox() {
	input_box_div = getbyid("input-box-div");
	style = window.getComputedStyle(input_box_div);
	var display = style.getPropertyValue('display');
	if (display == "none") {
		userMessage(ml.turn_on_input_box);
	} else {
		clearMessage();
	}
}
function writeKanji(kanji) {
	input_box_el = getbyid("input-box-input");
	checkInputBox();
	if (input_box_el.selectionStart) {
		if (input_box_el.selectionStart == input_box_el.value.length) {
			input_box_el.value += kanji;
		} else {
			var value = input_box_el.value;
			var s = input_box_el.selectionStart;
			var e = input_box_el.selectionEnd;
			var v_start = value.substring(0, input_box_el.selectionStart);
			var v_end   = value.substring(input_box_el.selectionEnd, value.length);

			value = v_start + kanji + v_end;
			input_box_el.value = value;
			input_box_el.selectionStart = s + kanji.length;
			input_box_el.selectionEnd = input_box_el.selectionStart;
		}
	} else {

		input_box_el.value += kanji;
	}
	input_box_el.focus();
	set_cookie(input_box_cookie + encodeURIComponent(input_box_el.value));
}
function wordRedirectURL(word) {
	return "/redirect/?word=" + encodeURIComponent(word);
}
function redirectURL(kanji) {
	return "/redirect/?kanji=" + encodeURIComponent(kanji);
}

function redirectLink(href, parent, kanji, windowPref) {
	var anchor = create_text_node("a", parent, kanji);
	anchor.href = href
	if (windowPref == 1) {
		anchor.target = "_blank";
	}
}
function create_link (parent, kanji, windowPref, linkMaker) {
	if (use_input_box) {
		var write_kanji_el = create_text_node("span", parent, kanji);
		write_kanji_el.className = "write-kanji";
		write_kanji_el.onclick = function() {
			writeKanji(kanji);
		}
		return
	}
	var linkPref = getLinkPreference();
	if (linkPref == "no_link") {
		append_text(parent, kanji);
		parent.className = "unlinked-kanji";
		return;
	}
	var href = redirectURL(kanji);
	linkMaker(href, parent, kanji, windowPref)
}
function clear_input_box() {
	var el = getbyid("input-box-input");
	if (el) {
		el.value = "";
		el.focus();
	}
	delete_cookie(input_box_cookie);
	clearMessage();
}

function search_input_box() {
	var link_preference = getLinkPreference();
	if (link_preference == 'no_link') {
		return;
	}
	var el = getbyid("input-box-input");
	var search_string = el.value;
	if (search_string.length == 0) {
		userMessage(ml.empty_search);
		return;
	}

	var href = wordRedirectURL(search_string);
	var windowPreference = getWindowPreference();
	if (windowPreference == 1) {
		window.open(href);
	}
	else {
		location.href = href;
	}
}

function change_input_box()
{
	var el = getbyid("input-box-input");
	var value = el.value;
	set_cookie(input_box_cookie + encodeURIComponent(value));
}

function initialize_input_box()
{
	use_input_box = get_input_box_preference();
	if (! use_input_box) {
		return;
	}
	show_input_box();
	var el = getbyid("input-box-input");
	el.onchange = change_input_box;
	el.focus();
	var v = get_cookie(input_box_cookie);
	if (! v) {
		return;
	}
	var value = decodeURI(v);
	if (value && value != "undefined"
		&& value != "=" /* ie bug */) {
		el.value = value;
	}
}

var n_radicals = 253;
var mr_buttons_selected = 0;
var mr_button_states = new Array();
var mr_chosens = new Array();

function mr_update_buttons(button_states) {
	if (! button_states) {
		return;
	}
	for (i = 0; i < n_radicals; i++) {
		var state = button_states.substring(i, i+1);
		var radical_button = getbyid("rad_"+(i+1));

		var className = radical_button.className;
		className = className.replace(/\s*(invalid|choice|chosen)/g, "");
		radical_button.className = className;
		if (state == "I") {
			radical_button.className += ' invalid';
			mr_button_states[i+1] = -1;
		} else if (state == "P") {
			mr_button_states[i+1] = 0;
			radical_button.className += ' choice';
		} else if (state == "C") {
			mr_button_states[i+1] = 1;
			radical_button.className += ' chosen';
		}
	}
}

var kanji_results;

function mr_show_kanji_list(data) {
	var kanji_match = JSON.parse(data);
	if (! kanji_match) {
		return;
	}
	var n_kanji = kanji_match.n_results;
	mr_update_buttons(kanji_match.buttons);
	kanji_results = new KanjiResults(kanji_match.results, n_kanji);
	kanji_results.show();
}

function mr_reset_buttons()
{
	for (var i = 1; i <= n_radicals; i++) {
		var radid = "rad_"+i;
		var r = getbyid(radid);
		r.classList.remove("invalid");
		r.classList.remove("chosen");
		r.classList.add("choice");
		mr_chosens[i] = 0;
		mr_button_states[i] = 0;
	}
	mr_buttons_selected = 0;
	kanji_results.clear();
}
function mr_push_button(radical_id)
{
	if (mr_button_states[radical_id] == -1) {

		return;
	}
	if (mr_chosens[radical_id] == 1) {

		mr_chosens[radical_id] = 0;
		mr_buttons_selected--;
	} else {

		mr_chosens[radical_id] = 1;
		mr_buttons_selected++;
	}
	if (mr_buttons_selected)
		mr_get_kanji();
	else
		mr_reset_buttons();
}

function mr_get_kanji() 
{
	var params = "M=";
	var m_buttons = new Array();
	for (radical in mr_chosens)
	if (mr_chosens[radical] == 1)
			m_buttons.push(radical);
	params += m_buttons.join(" ");
	params += "&o=j";
	sendget(params, mr_show_kanji_list);
}
function mr_start_buttons() 
{
	for (var i = 1; i <= n_radicals; i++) {
		var rad_i = getbyid("rad_"+i);
	   (function(i) {
			rad_i.onclick = function() {mr_push_button(i)};
		}(i));
		mr_button_states[i] = 0;
	}
	var pressed = gup("b");
	if (typeof(pressed) == "string" &&
		pressed.length > 0) {
		mr_push_button(pressed);
	}
	else if (typeof(pressed) == "object") {
		for (var i = 0; i < pressed.length; i++) {
			mr_push_button(pressed[i]);
		}
	}
	var r = resultsReset();
	r.onclick = mr_reset_buttons;
}

FourCorner.prototype.addResult = function(fcResult_json) {
	var fcResult = JSON.parse(fcResult_json);
	var buttons = fcResult.buttons;
	var button_states = buttons.split("");
	for (var cn = 0; cn < 5; cn++) {
		for (var bn = 0; bn < 10; bn++) {
			var state;
			var i = cn * 10 + bn;
			if (button_states[i] == "I") {
				state = "invalid";
			} else if (button_states[i] == "P") {
				state = "choice";
			} else if (button_states[i] == "C") {
				state = "chosen";
			}
			var button = this.states[cn][bn].button;
			this.states[cn][bn].state = state;
			button.className = state;
		}
	}
	this.kanji_results = new KanjiResults(fcResult.results, fcResult.n_results);
	this.kanji_results.show();
}
FourCorner.prototype.reset = function() {
	for (var cn = 0; cn < 5; cn++) {
		this.clicked[cn] = -1;
		for (var bn = 0; bn < 10; bn++) {
			var state;
			var button = this.states[cn][bn].button;
			this.states[cn][bn].state = "choice";
			button.className = "choice";
		}
	}
	this.selected = 0;
	if (this.kanji_results) {
		this.kanji_results.clear();
	}
	this.resetButton.disabled = true;
}

FourCorner.prototype.send = function() {

	var r="4=";
	for (x in this.clicked) {
		if (this.clicked[x] >= 0) {
			r += x + " " + this.clicked[x] + "  ";
		}
	}
	var self = this;
	r += "&o=j";
	sendget(r, function(reply) {
		self.addResult(reply);
	}, "/ppkanji/");
}
FourCorner.prototype.choose = function(cn,bn) {
	var button = this.states[cn][bn].button;

	var clicked = this.clicked[cn];
	if (clicked >= 0) {
		if (clicked == bn) {
			this.clicked[cn] = -1;
			this.selected--;
		} else {
			return;
		}
	} else {
		var state = this.states[cn][bn].state;
		if (state == "invalid") {
			return;
		} else {
			this.clicked[cn] = bn;
			this.selected++;
		}
	}
	if (this.selected > 0) {
		this.send ();
	} else {

		this.reset();
	}
}

function resultsReset() {
	return getbyid("results-reset-button");
}

function FourCorner() {
	this.selected = 0;
	this.states = new Array();
	this.clicked = new Array();
	var self = this;
	for (var cn = 0; cn < 5; cn++) {
		this.states[cn] = new Array();
		this.clicked[cn] = -1;
		for (var bn = 0; bn < 10; bn++) {
			var id="fc" + cn + "v" + bn;
			var button = getbyid(id);
			this.states[cn][bn] = {"button": button, "state": "choice"};
			(function(c, b) {
				button.onclick = function() {self.choose(c, b)};
			}(cn, bn));
		}
	}
	this.resetButton = resultsReset();
	this.resetButton.onclick = function() {
		self.reset();
	}
	var initial = gup("i");
	if (initial) {
		var buttons = initial.split("");
		var cn;
		for (var i = 0; i < 6; i++) {
			if (i == 4) {
				continue;
			} else if (i == 5) {
				cn = 4;
				bn = buttons[5];
			} else {
				cn = i;
				bn = buttons[i];
			}
			this.clicked[cn] = bn;
			this.selected++;
		}
		this.send ();
	}
}
function fc_start_buttons() {
	var fc = new FourCorner();
}
function change_language() {
	var lang_select = getbyid("lang_select");
	var new_lang = lang_select.value;
	var current_href = location.href;
	var param_string = current_href.match(/(\?.*)$/);
	if (param_string) {
		new_lang += param_string[1];
	}
	location.href = new_lang;
}

var obscurestate = 'visible';
function toggleobscure() {
	var obscure = document.getElementById("obscure");
	if (obscurestate == 'visible') {
		obscurestate = 'hidden';
	} else if (obscurestate == 'hidden') {
		obscurestate = 'visible';
	}
	obscure.style.visibility = obscurestate;	
	var toggler = document.getElementById("toggleobscuretext");
	if (obscurestate == 'visible') {
		toggler.innerHTML = trans_hide_obscure;
	} else { 
		toggler.innerHTML = trans_show_obscure;
	}
}
function goTo(event, link)
{

	if (event.ctrlKey) {
		window.open(link);
		return;
	}

	location.href = link;
}

const numbersCookie = "draw_show-numbers";
function setNumbersAlways()
{
	set_cookie(numbersCookie + "=always");
	return false;
}
function setNumbersNever()
{
	set_cookie(numbersCookie + "=never");
	return false;
}
function setNumbersDefault()
{
	delete_cookie(numbersCookie);
	return false;
}
function getNumbers() {
	var show = get_cookie(numbersCookie);
	if (show === null) {
		show = "default";
	}
	else if (show == "0") {
		show = "never";
	}
	else if (show == "1") {
		show = "always";
	}
	return show;
}

const multicolourCookie = "multicoloured";

function setMulticoloured ()
{
	element = getbyid('multicolour');
	if (element.checked) {
		set_cookie(multicolourCookie + "=1");
	}
	else {
		set_cookie(multicolourCookie + "=0");
	}
	return false;
}

function getMulticoloured ()
{
	multicoloured = get_cookie(multicolourCookie)
	if (typeof(multicoloured) == "undefined") {
		return true;
	}
	if (multicoloured == "0") {
		return false;
	}
	return true;
}

function setNumbersChecked() {
	var numbers = getNumbers()
	var numbers_default = document.getElementById("numbers-default")
	if (numbers != "default") {
		numbers_default.checked = false
		var chosen = document.getElementById("numbers-" + numbers)
		chosen.checked = true
		return;
	}
	numbers_default.checked = true;
}

function setMulticolourChecked() {
	var element = document.getElementById("multicolour");
	element.checked = getMulticoloured();
}

const saveCookie = "draw_save-my-input";
const saveElement = "save-my-input";

function readSave() {
	return get_cookie(saveCookie);
}

function writeSave(v) {
	set_cookie(saveCookie + "=" + v);
}
function getSave() {
	var save = readSave();
	if (typeof(save) == "undefined") {
		return true;
	}
	if (save == "0") {
		return false;
	}
	return true;
}
function setSave() {
	element = getbyid(saveElement);
	if (element.checked) {
		writeSave("1");
	}
	else {
		writeSave("0");
	}
	return false;
}
function setSaveChecked() {
	element = getbyid(saveElement);
	element.checked = getSave();
}
function optionCookieSetup() {
	setMulticolourChecked();
	setNumbersChecked();
	setSaveChecked();
	setOldButtonsChecked();
	return false;
}

var oldButtonsCookie = "oldButtons";
var oldButtonsElement = "use-old-buttons";

function toggleOldButtons() {
	var oldButtonSelect = getbyid(oldButtonsElement);
	var checked = oldButtonSelect.checked;
	if (checked) {
		set_cookie(oldButtonsCookie + "=1");
	} else {
		delete_cookie(oldButtonsCookie);
	}
}

function oldButtonsChecked() {
	var ob = get_cookie(oldButtonsCookie);
	if (ob == "1") {
		return true;
	}
	return false;
}

function setOldButtonsChecked() {
	var checked = oldButtonsChecked();
	var oldButtonSelect = getbyid(oldButtonsElement);
	oldButtonSelect.checked = checked;
}

function drawOptionReset() {
	delete_cookie(numbersCookie);
	delete_cookie(multicolourCookie);
	delete_cookie(saveCookie);
	delete_cookie(oldButtonsCookie);
	optionCookieSetup();
}

