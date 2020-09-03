var canvas = document.querySelector('canvas#game')
var context = canvas.getContext('2d')
var fontImage = null
var fontInfo = null
var overlayNames = null
var selectedGenerator = 'srb2'
var assetsPath = 'assets/'
var maxCharDelay = 35-1 // TICRATE-1
var introLineSpacing = 12

var renderedTypewriter
var lastTextDelay, lastTextSpeed
var cutsceneDelay, cutsceneSpeed
var currentDelayIndex, currentSpeedIndex

function initTypewriter()
{
	renderedTypewriter = 0
	lastTextDelay = null
	lastTextSpeed = null
	cutsceneDelay = []
	cutsceneSpeed = []
	currentDelayIndex = 0
	currentSpeedIndex = 0
}

initTypewriter()

function isCharSpeedChange(char)
{
	return (char >= 0xA0 && char <= 0xAF)
}

function isCharDelayChange(char)
{
	return (char >= 0xB0 && char <= (0xB0+maxCharDelay))
}

function first(){
	for(var i=0;i<arguments.length;i++){
		if(arguments[i] !== undefined){
			return arguments[i]
		}
	}
}

class BitmapFont {
	constructor(info, image) {
		this.info = info
		this.image = image
		this.y = info.origin.y
	}
}

class NewLine{
	constructor(){
		this.type = 'NewLine'
	}
}

class LineGroup{
	constructor(firstLine){
		this.firstLine=firstLine
		this.snippets = []
		this.height = 0
	}

	add(snippet){
		this.snippets.push(snippet)
		this.height = Math.max(this.height, snippet.getHeight(this.firstLine))
	}

	getWidth(){
		var w=0
		for(var snippet of this.snippets){
			w+=snippet.getWidth()
		}
		return w
	}

	getHeight(){
		return this.height
	}

	isEmpty(){
		return this.snippets.length == 0
	}

	draw(context, scale, xStart, y){
		var x = xStart
		for(let snippet of this.snippets){
			x = snippet.draw(context, scale, x, y)
		}
	}
}

class Snippet{
	constructor(font, text){
		this.type = 'Snippet'
		this.font = font
		this.text = text
	}

	setDelay(char) {
		if (!cutsceneDelay[currentDelayIndex])
		{
			lastTextDelay = char.delay
			cutsceneDelay[currentDelayIndex] = true
		}
		currentDelayIndex++
	}

	setSpeed(char) {
		if (!cutsceneSpeed[currentSpeedIndex])
		{
			lastTextSpeed = char.speed
			cutsceneSpeed[currentSpeedIndex] = true
		}
		currentSpeedIndex++
	}

	draw(context, scale, xStart, y){
		var x=xStart
		var last = 0
		var lastchar = -1 
		for(let char of this.parse()){
			if(lastchar in char['unadvance-after']){
				x-= char['unadvance-after'][lastchar]
			}
			context.drawImage(this.font.image,char.x,char.y,char.w,char.h,x*scale,y*scale,char.w*scale,char.h*scale)
			if (!char.special)
				x+=(char.w - char.unadvance)

			// Lactozilla: Set cutscene delay and speed
			if (char.delay && cutsceneDelay)
				this.setDelay(char)
			if (char.speed && cutsceneSpeed)
				this.setSpeed(char)

			last = char.unadvance
			lastchar = char.char
		}
		return x + last
	}

	parse(fontOriginY=0){
		var out=[]
		var font = this.font.info
		var defaultInfo = first(font.default, {})
		// FIXME: can doing uppercase/lowercase break astral codepoints?
		var line = this.text
		if(font['case-fold'] == 'upper'){
			line = line.toUpperCase()
		}else if(font['case-fold'] == 'lower'){
			line = line.toLowerCase()
		}
		for(var i=0;i<line.length;i++){
			var c=line.charCodeAt(i)
			if(c>= 0xD800 && c<=0xDBFF){
				c = line.codePointAt(i)
				i++; // Can this be more than 2? ARG JS UNICODE IS BAD
			}
			var info=font[c]
			if(info==null){
				info=font[font["null-character"]]
			}

			var x=first(info.x, defaultInfo.x)

			var speed = null;
			var delay = null;
			if (isCharSpeedChange(c))
				speed = (c - 0xA0);
			else if (isCharDelayChange(c))
				delay = (c - 0xB0);

			out.push({
				'x': x,
				'y': first(info.y, defaultInfo.y, fontOriginY),
				'w': first(info.w, defaultInfo.w),
				'h': first(info.h, defaultInfo.h),
				'speed': speed,
				'delay': delay,
				'special': (speed || delay),
				'unadvance': first(info.unadvance, defaultInfo.unadvance, 0),
				'unadvance-after': first(info['unadvance-after'],{}),
				'char':c
			})
		}
		return out
	}

	getWidth(){
		var w=0
		var last = 0
		var lastchar = -1
		for(var char of this.parse()){
			if (char.special)
				continue
			last = char.unadvance
			w += char.w - char.unadvance
			if(lastchar in char['unadvance-after']){
				w-= char['unadvance-after'][lastchar]
			}
			lastchar = char.char
		}
		return w + last
	}

	getHeight(firstLine){
		var info = this.font.info
		if(firstLine){
			return first(info['first-height'], info['height'])
		}else{
			return info['height']
		}
	}

}

class FontManager{
	constructor(context, text, fonts) {
		this.context = context
		this.text = text
		this.fonts = fonts
		this.lines = this.applyMarkup()
	}

	splitSnippet(font, text ){
		var parts = text.split(/(\n)/)
		var out=[]
		for(var part of parts){
			if(part=='\n'){
				out.push(new NewLine())
			}else{
				out.push(new Snippet(font, part))
			}
		}
		return out
	}

	buildLines(pieces){
		var out=[]
		var line = new LineGroup(true)
		for(var piece of pieces){
			if(piece instanceof NewLine){
				out.push(line)
				line = new LineGroup(false)
			}else{
				line.add(piece)
			}
		}
		if(!line.isEmpty()){
			out.push(line)
		}
		return out
	}

	applyMarkup(){
		var parts = this.text.split("^abc$") // (/\[(\/?[:_a-zA-Z0-9]*)\]/)
		parts.unshift('/')
		var out=[]
		for(var i=0;i<parts.length;i+=2){
			var marker = parts[i]
			var text = parts[i+1]
			if(text!==''){ // Skip empty text segments
				if(marker.startsWith('/')){
					marker='main'
				}
				if(!(marker in this.fonts)){
					marker='main'
				}
				for(var snippet of this.splitSnippet(this.fonts[marker], text)){
					out.push(snippet)
				}
			}
		}
		return this.buildLines(out)
	}

	getHeight(){
		var height = 0
		for(var line of this.lines){
			height += line.getHeight()
		}
		return height
	}

	getWidth(){
		var width = 0
		for(var line of this.lines){
			width = Math.max(width,line.getWidth())
		}
		return width
	}

	draw(mainFont, scale, originx, originy, justify){
		var y = originy
		for(var line of this.lines){
			var x = originx
			if(justify == 'center'){
				x = 160 - Math.floor(line.getWidth()/2)
			}
			line.draw(this.context, scale, x, y)
			var spacing
			if ($('#spacing').prop('checked'))
				spacing=introLineSpacing
			else
				spacing=line.getHeight()
			y+=spacing
		}
	}

}


var introtext =
`As it was about to drain the rings
away from the planet, Sonic burst into
the control room and for what he thought
would be the last time,[0xB4] defeated
Dr. Eggman.`

function selectGenerator(){
	var sourcetext = $('#sourcetext');

	if(sourcetext.text().length==0){
		$('#sourcetext').text(introtext)
	}
	$('#sourcetext').scrollTop($('#sourcetext')[0].scrollHeight);

	$('#throbber').hide()
	$('#uploading').hide()
	$('a#upload').show()

	fontInfo=null // Prevent flash of gibberish when switching images
	loadJSONForGenerator()
	$('.source').remove();

	fontImage = $('<img id="font" class="source" />').attr('src', assetsPath + 'font.png').appendTo('body')[0]
	$('.source').waitForImages(true).done(function(){
		renderText()
	});


}

function parseOverlays(fontInfo){
	var overlays = {}
	if ('overlays' in fontInfo) {
		for(var i=0;i<overlayNames.length;i++){
			var oname=overlayNames[i]
			var currentOverlay=fontInfo.overlays[oname]

			var overlayPos=null

			var sname = $('#overlay-'+oname+' option:selected').val()
			var adv=currentOverlay.options[sname]

			var textx = fontInfo.origin.x
			var texty = fontInfo.origin.y
			var offsx = 0
			var offsy = 0
			var wrapx = 0

			if ('offsets' in currentOverlay)
			{
				var offsets = currentOverlay.offsets
				if (offsets.hasOwnProperty(sname))
					overlayPos=offsets[sname]
			}

			if (overlayPos != null)
			{
				textx = overlayPos.textx || textx
				texty = overlayPos.texty || texty
				offsx = overlayPos.offsx || 0
				offsy = overlayPos.offsy || 0
				wrapx = overlayPos.wrapx || 640
			}

			overlays[oname] = {
				"name":sname,
				"x":currentOverlay.x,
				"y":currentOverlay.y,
				"offsx":offsx,
				"offsy":offsy,
				"textx":textx,
				"texty":texty,
				"wrapx":wrapx,
				"blend":first(currentOverlay['blend-mode'], 'source-over'),
				"stage":first(currentOverlay.stage, "main"),
				"title":first(currentOverlay.title,sname),
				"data":adv
			}

		}
	}
	return overlays
}

function getOptions(){
	let opts = {
		'main-text': $('#sourcetext').val()
	};
	$('select').each(function(_,e){
		opts[$(e).attr('id').split('-',2)[1]] = $(e).val()
	});
	return opts;
}

function setOptions(opts){
	$('#sourcetext').val(opts['main-text'])

	$('select').each(function(_,e){
		$(this).val(opts[$(e).attr('id').split('-',2)[1]])
	});
	return opts;
}

function getAllPossibleOptions(){
	let opts={}
	$('select').each(function(_,e){
		let sopt = opts[$(e).attr('id').split('-',2)[1]] = []
		$(this).find('option').each(function(_,o){
			sopt.push($(o).val())
		})
	});

	return opts;
}

function testWhite(x) {
	var white = new RegExp(/^\s$/);
	return white.test(x.charAt(0));
}

function getStringWidth(str, font)
{
	var length = 0
	for (i = 0; i < str.length; i++) {
		var info = font[str.charCodeAt(i)]
		if (info == null)
			info = font[font["null-character"]]
		length += (info.w * font.fontscale * 2)
	}
	return length
}

function wordWrap(str, font, baseX, maxWidth) {
	var slength = str.length
	var length = getStringWidth(str, font)
	var res = str

	maxWidth -= (baseX * font.fontscale)

	if (length < maxWidth)
		return str

	var i
	var x = 0
	var lastusablespace = 0

	for (i = 0; i < slength; i++) {
		var char = res.charCodeAt(i)

		if (isCharSpeedChange(char) || isCharDelayChange(char))
			continue

		if (char == 10)
		{
			x = 0
			lastusablespace = 0
			continue
		}

		var info = font[char]
		if (info == null || char == 32) {
			info = font[font["null-character"]]
			lastusablespace = i
		}

		x += ((info.w || 8) * font.fontscale)

		if (lastusablespace != 0 && x > maxWidth) {
			var split = res
			res = split.slice(0, lastusablespace)
			res += '\n'
			res += split.slice(lastusablespace+(split.charAt(lastusablespace) == ' ' ? 1 : 0))
			i = lastusablespace
			lastusablespace = 0
			x = 0
		}
	}

	return res
}

function renderText(scaled = true, typewrite = false){
	if(fontInfo == null){
		return
	}

	// Define the top-level font
	var mainFont = new BitmapFont(fontInfo, fontImage)
	var fonts={
		'main': mainFont
	}
	if('subfonts' in fontInfo){
		for(var key of Object.keys(fontInfo.subfonts)){
			fonts[key] = new BitmapFont(fontInfo.subfonts[key], fontImage)
		}
	}
	if('shiftfonts' in fontInfo){
		for(var key of Object.keys(fontInfo.shiftfonts)){
			// Make a local clone of the JSON tree
			var fontcopy = JSON.parse(JSON.stringify(fontInfo))
			if(!'default' in fontcopy){
				fontcopy['default'] = {}
			}
			fontcopy['default']['y'] = fontInfo.shiftfonts[key]
			fonts[key] = new BitmapFont(fontcopy, fontImage)
		}
	}

	var overlays = parseOverlays(fontInfo)
	var baseoverlay = overlays[overlayNames[0]]

	var rawtext = document.querySelector("textarea#sourcetext").value

	// apply text delay / speed
	var parts = rawtext.split(/\[([!@0]\/?[:_a-zA-Z0-9]*)\]/)
	parts.unshift('/')

	var out=[]

	rawtext=''

	for(var i=0;i<parts.length;i+=2){
		var marker = parts[i]
		var text = parts[i+1]
		//if(text!==''){ // Skip empty text segments

		if(marker.startsWith('/')){
			marker=''
		}

		var type = marker.charAt(0);
		var isHex = false;

		if (marker.slice(0, 2) == '0x')
		{
			num = parseInt(Number(marker), 10);
			isHex = true;
		}
		else
			num = parseInt(marker.slice(1), 10);

		if (!Number.isNaN(num))
		{
			var charcode = 0;

			function setSpeed(speed)
			{
				charcode = (0xA0 + Math.max(0, Math.min(speed, 16)));
			}

			function setDelay(delay)
			{
				charcode = (0xB0 + Math.max(0, Math.min(delay, maxCharDelay)));
			}

			if (isHex)
			{
				if (isCharSpeedChange(num))
				{
					num -= 0xA0;
					setSpeed(num);
				}
				else if (isCharDelayChange(num))
				{
					num -= 0xB0;
					setDelay(num);
				}
			}
			else if (type == '!') // speed
			{
				if (num >= 0xA0)
					num -= 0xA0;
				setSpeed(num);
			}
			else if (type == '@') // speed
			{
				if (num >= 0xB0)
					num -= 0xB0;
				setDelay(num);
			}

			if (charcode)
				rawtext += String.fromCharCode(charcode);
		}

		rawtext += text;
	}

	if ($('#wordwrap').prop('checked'))
		rawtext = wordWrap(rawtext, mainFont.info, baseoverlay.textx, baseoverlay.wrapx || 640)

	var baseTextLength = rawtext.length
	if (typewrite)
		rawtext = rawtext.slice(0, Math.min(renderedTypewriter, baseTextLength))

	var fontManager = new FontManager(context, rawtext, fonts)

	var textbox={
		w: fontManager.getWidth(),
		h: fontManager.getHeight()
	}


	var outputSize={
		w:640,
		h:400,
	}
	if('dynamic-size' in fontInfo){
		outputSize.w = eval(fontInfo['dynamic-size'].w)
		outputSize.h = eval(fontInfo['dynamic-size'].h)
	}
	var buffer = 10
	var browserScale = $(window).width() / (outputSize.w + buffer)

	var fontScale = first(fontInfo.scale, 2);

	var scale = Math.min(browserScale, fontScale)
	if(!scaled){
		scale = fontScale
	}

	var realFontScale = scale
	if (fontInfo.fontscale){
		realFontScale = realFontScale * fontInfo.fontscale
	}

	context.canvas.width = outputSize.w * scale
	context.canvas.height = outputSize.h * scale
	context.imageSmoothingEnabled = false

	function clearCanvas(ctx)
	{
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.fillRect(0, 0, 640*scale, 400*scale)
	}

	function drawMainScene(adv, source, drawtext)
	{
		clearCanvas(context)

		context.drawImage(source,
			adv.x + (adv.offsx * scale * 2), adv.y + (adv.offsy * scale * 2),
			source.width * scale, source.height * scale)

		// draw the text
		if (drawtext)
		{
			var x = 0
			var y = 0

			if ($('#textpos').prop('checked')) {
				x = adv.textx
				y = adv.texty
			}

			fontManager.draw(mainFont, realFontScale, x, y, 0)
		}
	}

	function drawOverlays(stage){
		var count = 0;
		Object.keys(overlays).forEach(function (key) {
			var adv = overlays[key]
			if(adv.stage == stage){
				context.globalCompositeOperation = adv.blend

				if (adv.canvas == null)
				{
					var image = $('<img id="scene" class="sceneimage" />').attr('src', assetsPath + 'scenes/' + adv.name + '.png').appendTo('body')[0]

					adv.canvas = document.getElementById("scene");
					adv.canvas.style.display = "none";

					image.addEventListener('load', e => {
						adv.canvas.width = image.width
						adv.canvas.height = image.height

						var ctx = adv.canvas.getContext('2d')
						clearCanvas(ctx)
						ctx.drawImage(image, 0, 0)

						drawMainScene(adv, adv.canvas, true)
					});

					$('.sceneimage').remove();
				}

				drawMainScene(adv, adv.canvas, (count + 1) == Object.keys(overlays).length);
			}
			count++;
		})
		context.globalCompositeOperation = "source-over"
	}

	// Clear before drawing, as transparents might get overdrawn
	clearCanvas(context)

	drawOverlays('main')

	return (typewrite && (renderedTypewriter >= baseTextLength))
}



function resetOverlays(){
	overlayOverrides = {}
	overlayNames = []
	$('.overlays p').remove()
	if('overlays' in fontInfo){
		var overlays = fontInfo.overlays
		for(key in overlays) {
			if(overlays.hasOwnProperty(key)) {
				overlayNames.push(key)
				var overlay = overlays[key]
				var pwrapper=$("<p>").text(overlay.title+': ')
				if(overlay.title ==''){
					// Internal effect, don't show to the user
					pwrapper.addClass('internal-overlay')
				}
				var select = $('<select class="overlay-selector">').attr('id','overlay-'+key)
				for(opt in overlay.options){
					if(overlay.options.hasOwnProperty(opt)){
						var optname = overlay.options[opt];
						$('<option>').text(first(optname,optname)).attr('value',optname).prop('selected',optname==overlay['default']).appendTo(select)
					}
				}
				select.appendTo(pwrapper)
				pwrapper.appendTo($('.overlays'))
			}
		}
	}
	$('.overlays select').change(function(){
		var name = $(this).attr('id').split('-',2)[1]
		var hookname = 'change-'+name
		if('hooks' in fontInfo && hookname in fontInfo.hooks){
			eval(fontInfo.hooks[hookname])
		}
		renderText()
	})

}

function loadJSONForGenerator(){

	gamesPath = 'assets/'
	$.getJSON(gamesPath + "srb2.json",function(data){
		fontInfo = data
		resetOverlays()
		renderText()
		if(fontInfo.script){
			$.getScript(gamesPath + "srb2.js");
		}
	})

}

function getNameForCurrentImage(ext){
	return "srb2cutscenegenerator" + "-" + new Date().getTime() + "." + ext;
}


selectGenerator()
$('#sourcetext').keyup(renderText)
$(window).resize(function () { renderText() });

$('.wordwrap').change(renderText)
$('.textpos').change(renderText)
$('.spacing').change(renderText)

function makeGIF(context){
	var numtowrite
	var speed

	function setSpeed(spd)
	{
		speed = spd
		if (speed < 7)
			numtowrite = (8 - speed)
		else
			numtowrite = 1
	}
	setSpeed(document.getElementById("textdelay").value)

	var encoder = new GIFEncoder()
	encoder.setComment(document.querySelector("textarea#sourcetext").value.slice(0, 255))
	encoder.setPalette(srb2palette)
	encoder.setRepeat(0)

	encoder.setOptimization($('#optimize').prop('checked') ? (speed >= 7) : false)
	encoder.setDownscaling($('#downscale').prop('checked') ? 2 : 1)

	initTypewriter()
	encoder.start()

	renderText(false, true)
	encoder.setDelay(500)
	encoder.addFrame(context)
	encoder.setDelay(33)

	while(true){
		var done = renderText(false, true)

		if (lastTextSpeed)
			setSpeed(lastTextSpeed)
		renderedTypewriter += numtowrite

		var delay = 33
		if (lastTextDelay)
		{
			delay += (17 * lastTextDelay)
			lastTextDelay = null
		}

		if (speed > 7)
			encoder.setDelay(delay * (speed - 7))
		else
			encoder.setDelay(delay)

		encoder.addFrame(context)

		currentDelayIndex = 0
		currentSpeedIndex = 0

		if (done)
			break
	}

	cutsceneDelay = null
	cutsceneSpeed = null

	encoder.setDelay(5000)
	encoder.addFrame(context)
	/* Twitter MP4 Fix:
	   Twitter drops the last frame of MP4 files, so on desktop these will loop too fast.
	   We don't just show the last frame twice with full length, because mobile does
	   NOT drop the last frame, and therefore the last frame delay would be twice as long
	   there. This gives us a very tiny difference between mobile and desktop, which should
	   be fine. */
	encoder.setDelay(20)
	encoder.addFrame(context)
	encoder.finish()

	return (new Uint8Array(encoder.stream().bin))
}
$('#makegif').click(function(){
	this.href = URL.createObjectURL(new Blob([makeGIF(context)], {type : "image/gif" } ))
	this.download = getNameForCurrentImage("gif")
	return true
})


function getDataURLImage(){
	// generate an unscaled version
	renderText(false)
	return context.canvas.toDataURL('image/png')
}

function base64ImageConvert(image)
{
	var b64 = '';
	for (var i = 0; i < image.length; i++)
		b64 += String.fromCharCode(image[i]);
	return btoa(b64);
}

$('#save').click(function(){
	this.href = getDataURLImage()
	this.download = getNameForCurrentImage("png")
	return true
})
$('a#upload').click(function(){
	var imgdata = base64ImageConvert(makeGIF(context));
	$(this).hide()
	$('#throbber').show()
	$('#uploading').text('Uploading...').show()

	$.ajax({
		url: 'https://api.imgur.com/3/image',
		type: 'POST',
		headers: {
			Authorization: 'Client-ID 68dc4ab71488809',
			Accept: 'application/json'
		},
		data: {
			image: imgdata,
			type: 'base64',
			name: 'upload.gif'
		},
		success: function(result) {
			$('#throbber').hide()
			if(result.success && result.data.link){
				var link = result.data.link;
				$('#uploading').text('Uploaded to ').append(
					$('<a>').attr('href',link).text(link)
				)
			}else{
				$('#uploading').text('Error uploading to imgur!')
			}
		},
		error: function(result) {
			$('#throbber').hide()
			$('#uploading').text('Error uploading to imgur!')
		}
	});
	return false
})

