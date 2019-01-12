// Minimum 3 bufferElement
window.ScarletsAudioBufferStreamer = function(bufferElement, chunksDuration, webAudio){
	if(!bufferElement || bufferElement < 3) bufferElement = 3;
	if(!chunksDuration) chunksDuration = 1000;

	var scope = this;

	scope.debug = false;
	scope.bufferElement = [];
	scope.bufferAvailable = [];
	scope.bufferPending = [];
	scope.currentBuffer = 0;
	scope.playing = false;
	scope.buffering = false;
	scope.streaming = false;
	scope.currentDuration = false;
	scope.latency = 0;
	scope.error = 0;
	scope.realtime = false;
	scope.bufferSkip = 0.07;
	scope.mimeType = null;

	// Use webAudio for mobile, and HTML5 audio for computer
	scope.webAudio = webAudio || ScarletsMedia.extra.isMobile() ? true : false; // Mobile browser have security on HTML element
	scope.audioContext = ScarletsMedia.audioContext;
	scope.outputNode = false; // Set this to a connectable Audio Node  
	// Avoid webAudio for computer browser because memory usage

	var bufferHeader = false;
	var bufferHeaderLength = false;

	scope.setBufferHeader = function(arrayBuffer){
		if(!arrayBuffer){
			bufferHeader = bufferHeaderLength = false;
			return;
		}

		bufferHeader = arrayBuffer;
		bufferHeaderLength = arrayBuffer.byteLength;

		// Find buffer skip
		if(scope.audioContext)
			scope.audioContext.decodeAudioData(arrayBuffer.slice(0), function(audioBuffer){
				scope.bufferSkip = audioBuffer.duration;
			});
	}

	// First initialization
	for (var i = 0; i < bufferElement; i++) addBufferElement(i);
	function addBufferElement(i){
		if(scope.webAudio){
			scope.bufferElement.push(createBufferSource());
			scope.bufferAvailable.push(false);
		}
		else { // HTML5 Audio
			var audioHandler = new Audio();
			if(audioHandler){
				scope.bufferElement.push(audioHandler);
				scope.bufferAvailable.push(false);

				audioHandler.onended = function(){
					if(scope.debug) console.log("Buffer ended with ID: "+i);

					URL.revokeObjectURL(this.src);
					this.src = '';

					if(!scope.realtime){
						scope.bufferAvailable[i] = false;
						scope.playing = false;
						scope.buffering = true;
						scope.playAvailable();

						if(scope.bufferAvailable.indexOf(false) !== -1 && scope.bufferPending.length != 0)
							fillEmptyBuffer();
					}
				};
			}
		}
	}

	function createBufferSource(){
		var temp = scope.audioContext.createBufferSource();
		temp.onended = function(){
			this.stop();
			this.disconnect();
		}
		return temp;
	}

	var addBufferHeader = function(arrayBuffer){
		var finalBuffer = new Uint8Array(bufferHeaderLength + arrayBuffer.byteLength);
		finalBuffer.set(bufferHeader, 0);
		finalBuffer.set(new Uint8Array(arrayBuffer), bufferHeaderLength);
		console.log(finalBuffer.buffer);
		return finalBuffer.buffer;
	}

	scope.receiveBuffer = function(arrayBuffer){
		if(scope.debug) console.log("Receiving data", arrayBuffer[0].byteLength);
		if(!scope.streaming) return;
		var streamingTime = arrayBuffer[1];
		scope.realtime = false;

		if(chunksDuration){
			var unplayed = scope.bufferPending.length;
			for (var i = 0; i < bufferElement; i++) {
				if(scope.bufferAvailable[i]) unplayed++;
			}
			scope.latency = (Number(String(Date.now()).slice(-5, -3)) - streamingTime) 
								+ chunksDuration*unplayed + scope.audioContext.baseLatency;
			if(scope.debug) console.log("Total latency: "+scope.latency);
		}

		scope.bufferPending.push(arrayBuffer[0]);
		fillEmptyBuffer();

		if(scope.buffering)
			scope.playAvailable();
	}

	function webAudioBufferInsert(index, buffer){
		scope.bufferElement[index] = createBufferSource();
		scope.bufferElement[index].buffer = buffer;

		if(scope.outputNode && scope.outputNode.context)
			scope.bufferElement[index].connect(scope.outputNode);

		else // Direct output to destination
			scope.bufferElement[index].connect(scope.audioContext.destination);
	}

	var fileReader = new FileReader();
	var realtimeBufferInterval = 0; // Need 3 bufferElement, other than this will give lower quality
	scope.realtimeBufferPlay = function(arrayBuffer){
		if(scope.debug) console.log("Receiving data", arrayBuffer[0].byteLength);
		if(arrayBuffer[0].byteLength === 0) return;
		arrayBuffer = arrayBuffer[0];

		scope.latency = (Number(String(Date.now()).slice(-5, -3)) - arrayBuffer[1]) +
			chunksDuration/1000 + scope.audioContext.baseLatency;

		scope.realtime = true;
		
		var index = realtimeBufferInterval;
		realtimeBufferInterval++;
		if(realtimeBufferInterval > 2)
			realtimeBufferInterval = 0;

		if(scope.webAudio){
			fileReader.onload = function() {
				scope.audioContext.decodeAudioData(this.result, function(buffer){
					webAudioBufferInsert(index, buffer);
					scope.bufferElement[index].start(scope.bufferSkip);
				});
			};
			fileReader.readAsArrayBuffer(new Blob([bufferHeader, arrayBuffer], {type:scope.mimeType}));
		}
		else { // HTML5 Audio
			URL.revokeObjectURL(scope.bufferElement[index].src);
			scope.bufferElement[index].src = URL.createObjectURL(new Blob([bufferHeader, arrayBuffer], {type:scope.mimeType}));
			scope.bufferElement[index].load();
			scope.bufferElement[index].play();
			scope.bufferElement[index].currentTime = scope.bufferSkip;
		}
	}

	var fillEmptyBuffer = function(){
		var index = scope.bufferAvailable.indexOf(false, scope.currentBuffer);
		if(index==-1)
			index = scope.bufferAvailable.indexOf(false);
		if(index==-1||scope.bufferPending.length==0)
			return;

		if(scope.webAudio){
			fileReader.onload = function() {
				scope.audioContext.decodeAudioData(this.result, function(buffer){
					webAudioBufferInsert(index, buffer);
				});
			};
			fileReader.readAsArrayBuffer(new Blob([bufferHeader, scope.bufferPending[0]], {type:scope.mimeType}));
		}
		else { // HTML5 Audio
			scope.bufferElement[index].src = URL.createObjectURL(new Blob([bufferHeader, scope.bufferPending[0]], {type:scope.mimeType}));
			scope.bufferElement[index].load();
		}

		scope.bufferPending.shift();
		scope.bufferAvailable[index] = true;

		if(scope.buffering) scope.playAvailable();
		if(scope.debug) console.log("Buffer updated with ID: "+index);
	}

	scope.playBuffer = function(index){
		if(!scope.bufferElement[index].duration)
			return;

		if(scope.debug) console.log("Current stream duration: "+scope.bufferElement[index].duration);

		if(chunksDuration===false){ //Skip to end to get current duration
			chunksDuration = scope.bufferElement[index].duration;
			return;
		}

		scope.buffering = false;
		scope.playing = true;
		chunksDuration = scope.bufferElement[index].duration;
		if(scope.bufferElement[index].start)
			scope.bufferElement[index].start(scope.bufferSkip);
		else {
			scope.bufferElement[index].play();
			scope.bufferElement[index].currentTime = scope.bufferSkip;
		}

		scope.currentBuffer = index;
		if(scope.debug) console.log("Playing buffer ID: "+scope.currentBuffer);
	}

	scope.playAvailable = function(){
		if(scope.playing) return;

		if(scope.bufferAvailable[scope.currentBuffer])
			return scope.playBuffer(scope.currentBuffer);

		else{
			var index = scope.bufferAvailable.indexOf(true, scope.currentBuffer);
			if(index!=-1) return scope.playBuffer(index);

			else{ // Scan from first array
				index = scope.bufferAvailable.indexOf(true);
				if(index!=-1) return scope.playBuffer(index);
			}
		}
	}

	scope.playStream = function(){
		scope.streaming = scope.buffering = true;
	}

	scope.stop = function(){
		scope.bufferPending.splice(0);
		for (var i = 0; i < bufferElement; i++) {
			scope.bufferElement[i].stop();
			scope.bufferAvailable[i] = false;
		}
		scope.playing = false;
		scope.buffering = false;
		scope.currentBuffer = 0;
	}
}