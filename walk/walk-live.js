/* Gemini Live walk adapter. One audio owner; classic guide is explicit fallback.
 * A new page never silently reopens the mic. Guide/Continue is a user gesture. */
(function (global) {
 "use strict";
 var P = global.HKBKWalkGuide.WalkGuide.prototype;
 var classicStart=P.start, classicEnd=P.end, classicHear=P._hear, classicBuild=P.build;
 P.build=function(){
  classicBuild.call(this);var self=this;
  this.privacy=document.createElement('div');this.privacy.className='guide__privacy';
  this.privacy.textContent="Live voice sends microphone audio to Google. Google may use free-tier content to improve its products. Scene facts come from the HKBK knowledge base and this walk. End tour or hide this page to stop the mic.";
  this.panel.appendChild(this.privacy);
  this.resume=document.createElement('button');this.resume.className='guide__resume';this.resume.textContent='Continue with live voice';this.panel.appendChild(this.resume);
  this.resume.onclick=function(){self._startLive();};
  this.mic.addEventListener('click',function(){if(self.live){self.live._flush();self._status('Listening - LIVE');}});
  var hidden=function(){if(self.live||self._liveStarting){self._liveEpoch=(self._liveEpoch||0)+1;if(self.live)self.live.stop();self.live=null;self._liveStarting=false;self.resume.hidden=false;self._status('Microphone off - tap Continue to resume');}};
  global.addEventListener('pagehide',hidden);document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')hidden();});
 };
 P.start=function(){
  if(!global.HKBKGeminiLive||!global.HKBK_TALK_CONFIG.endpoint||/[?&]live=0\b/.test(location.search)){classicStart.call(this);return;}
  if(this.active)return;this.active=true;this.panel.classList.add('on');this.ctl.pause();this._stopRec();if(global.HKBKVoice)global.HKBKVoice.cancel();
  this._liveOnly=true;this._status('Live guide ready - tap Continue to start the microphone');this._caption('I can introduce each stop, move next or back, take you to a place, and answer questions as we walk.');this.resume.hidden=false;
 };
 P._scene=function(stop){
  stop=stop||this._currentStop();if(!stop)return {done:false,note:'No current stop is available.'};
  return {done:true,scene:{id:stop.id,name:stop.name,footage:stop.step!=null,verified_facts:global.HKBKWalkGuide.buildNarration(stop,this.entryFor(stop.id))},note:'Describe only these verified facts; do not add details from memory.'};
 };
 P._walkLive=function(args){
  var c=args.command,stop;
  if(c==='end'){this.end();return {done:true,note:'Tour ended and microphone stopped.'};}
  if(c==='context'||c==='repeat')return this._scene();
  if(c==='next'||c==='back')stop=this._adjacentStop(c==='next'?1:-1);
  if(c==='goto'){
   var a=global.HKBKTalkActions.parse('take me to '+args.place,{places:this.places,guiding:true});stop=a&&this.stopById(a.stopId);
  }
  if(!stop)return {done:false,note:c==='back'?'We are at the first stop, or that place is unavailable.':'No further matching stop is available.'};
  if(stop.step==null)return {done:false,note:'No footage is available for that stop.'};
  this.ctl.gotoStop(stop.id);this.lastChapter=stop.id;this.lastNarration=global.HKBKWalkGuide.buildNarration(stop,this.entryFor(stop.id));return this._scene(stop);
 };
 P._startLive=function(){
  if(this.live||this._liveStarting)return;var self=this,epoch=(this._liveEpoch||0)+1;this._liveEpoch=epoch;this._liveStarting=true;this.resume.hidden=true;this.active=true;
  this._stopRec();this.ctl.pause();if(global.HKBKVoice)global.HKBKVoice.cancel();this._status('Connecting live guide...');
  var text='';this.live=new global.HKBKGeminiLive.LiveSession({endpoint:global.HKBK_TALK_CONFIG.endpoint,tools:{
   lookup:function(q){var scene=self._currentStop();if(scene&&/\b(here|this|there|it)\b/i.test(q))q=q+' at '+scene.name;return global.HKBKGeminiLive.lookupQuestion(self.engine,q);},
   walk:function(a){return self._walkLive(a);},
   act:function(a){if(a.type==='show_place')return self._walkLive({command:'goto',place:a.place});if(a.type==='start_walk')return self._scene();return false;}
  },onEvent:function(t,d){
   if(epoch!==self._liveEpoch||!self.active)return;
   if(t==='model_text'){text+=d.text;self._caption(text);}
   if(t==='user_text'){text='';self._caption('You: '+d.text);}
   if(t==='ready'||t==='idle'||t==='turn_complete')self._status('Listening - LIVE');
   if(t==='speaking')self._status('Speaking - interrupt any time');
   if(t==='interrupted'){text='';self._status('Interrupted - listening');}
   if(t==='tool')self._status('Guiding - LIVE');
   if(t==='reconnecting')self._status('Reconnecting live guide...');
   if(t==='closed')self._liveFailed('Live connection ended.');
  }});
  this.live.start().then(function(){if(epoch!==self._liveEpoch||!self.active)return;self._liveStarting=false;self.live.sendText('We are on the guided walk. Introduce yourself briefly, then call walk_control context to introduce the current stop from its verified facts. Explain I can say next, back, take me to a place, ask a question, or end tour.');},function(err){if(epoch!==self._liveEpoch)return;self._liveFailed(/NotAllowed|denied/i.test((err.name||'')+' '+err.message)?'Microphone permission denied. Type below or allow it in site settings.':'Live voice is unavailable or its quota is used up.');});
 };
 P._liveFailed=function(reason){this._liveEpoch=(this._liveEpoch||0)+1;if(this.live)this.live.stop();this.live=null;this._liveStarting=false;this.resume.hidden=false;this._status(reason+' Microphone off.');this._caption('Live voice stopped. You can type commands and questions below; tap Continue to try live voice again.');};
 P._hear=function(text){if(this.live&&this.live.ready){this.live.sendText(text);return;}classicHear.call(this,text);};
 var classicSpeak=P._speak,classicListen=P._listen;
 P._speak=function(text,then){if(this.live||this._liveStarting||this._liveOnly){this._caption(text);if(then)then();return;}classicSpeak.call(this,text,then);};
 P._listen=function(){if(this.live||this._liveStarting||this._liveOnly)return;classicListen.call(this);};
 P.end=function(){this._liveEpoch=(this._liveEpoch||0)+1;if(this.live)this.live.stop();this.live=null;this._liveStarting=false;classicEnd.call(this);};
})(window);
