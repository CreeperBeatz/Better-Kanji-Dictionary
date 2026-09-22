

function DrawCanvas() {
    this.element = getbyid ("drawkanji-canvas");
    this.context = this.element.getContext("2d");
    this.has_canvas_text = (typeof this.context.fillText == 'function');
    this.size = 300;
    this.is_canvas = true;
}

DrawCanvas.prototype.start_line = function(x, y, colour) {
    this.context.lineWidth = 6.0;
    this.colour = colour;
    this.context.strokeStyle = this.colour;
    this.context.beginPath();
    this.context.moveTo(x, y);
}

DrawCanvas.prototype.draw_line = function(x, y) {
    this.context.lineTo(x, y);
    this.context.stroke();
}

DrawCanvas.prototype.clear = function() {
    this.context.clearRect(0,0,300,300);
}

DrawCanvas.prototype.draw_text = function(x, y, text) {
    if (! this.has_canvas_text)
        return;
    x -= 6;
    y += 6;
    this.context.font = "bold 12pt sans-serif";
    this.context.fillStyle = this.colour;
    this.context.fillText(text, x, y);
}

