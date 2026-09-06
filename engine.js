(function(global){
'use strict';
const data=global.SHAGHAF;
const lessons=data.lessons;
const lessonById=new Map(lessons.map(l=>[l.id,l]));
const questionById=new Map(lessons.flatMap(l=>l.questions.map(q=>[q.id,q])));
const BOOK=data.edition;
const num=(n,min=0,max=100000)=>Math.min(max,Math.max(min,Number.isFinite(Number(n))?Number(n):min));
const cleanText=(s,max=4000)=>typeof s==='string'?s.slice(0,max):'';
function freshState(){return {schema:2,book:BOOK,studentId:'',profile:'',points:0,read:[],last:'',notes:{},answers:{},lessons:{},games:{},awarded:{},attempts:[],settings:{sound:false,light:false,font:1}};}
function cleanState(raw){
 const s=freshState();if(!raw||raw.schema!==2||raw.book!==BOOK)return s;
 s.studentId=cleanText(raw.studentId,80);s.profile=cleanText(raw.profile,80);s.points=num(raw.points);
 s.read=[...new Set(Array.isArray(raw.read)?raw.read.filter(id=>lessonById.has(id)):[])];
 s.last=lessonById.has(raw.last)?raw.last:'';
 for(const l of lessons){
  const r=raw.lessons?.[l.id];
  if(r)s.lessons[l.id]={best:num(r.best,0,100),attempts:num(r.attempts,0,10000),last:num(r.last,0,1e15)};
  for(let i=0;i<l.reflection.length;i++){const key=l.id+'-'+i;if(typeof raw.notes?.[key]==='string')s.notes[key]=cleanText(raw.notes[key]);}
  for(const mode of ['match','classify']){const key=l.id+'-'+mode;const v=raw.games?.[key];if(v)s.games[key]={completed:v.completed===true,attempts:num(v.attempts,0,10000),last:num(v.last,0,1e15)};}
 }
 for(const [id,q]of questionById){
  const a=raw.answers?.[id];if(a)s.answers[id]={correct:a.correct===true,attempts:num(a.attempts,0,10000),due:num(a.due,0,1e15),last:num(a.last,0,1e15)};
  for(const key of ['q:'+id,'review:'+id])if(raw.awarded?.[key]===true)s.awarded[key]=true;
 }
 for(const l of lessons){for(const key of ['mastery:'+l.id,'game:'+l.id+'-match','game:'+l.id+'-classify'])if(raw.awarded?.[key]===true)s.awarded[key]=true;}
 if(Array.isArray(raw.attempts))s.attempts=raw.attempts.slice(-200).filter(x=>x&&Number.isFinite(x.score)).map(x=>({title:cleanText(x.title,180),lessonId:lessonById.has(x.lessonId)?x.lessonId:'',score:num(x.score,0,100),total:num(x.total,1,100),date:num(x.date,0,1e15)}));
 s.settings={sound:raw.settings?.sound===true,light:raw.settings?.light===true,font:num(raw.settings?.font||1,1,1.3)};
 return s;
}
function shuffle(arr,rng=Math.random){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function decorate(q,rng=Math.random){
 const options=shuffle(q.options.map((text,index)=>({text,index})),rng);
 return {...q,choices:options,correctChoice:options.findIndex(x=>x.index===q.answer)};
}
function makeLessonQuiz(id,rng=Math.random){
 const l=lessonById.get(id);if(!l)throw new Error('Unknown lesson');
 return shuffle([...shuffle(l.questions.filter(q=>q.type==='choice'),rng).slice(0,5),...shuffle(l.questions.filter(q=>q.type==='truth'),rng).slice(0,5)],rng).map(q=>decorate(q,rng));
}
function makeUnitQuiz(subject,unit,rng=Math.random){
 const pool=lessons.filter(l=>l.subject===subject&&l.unit===unit);if(!pool.length)throw new Error('Unknown unit');
 const queues=pool.map(l=>shuffle(l.questions,rng));const picked=[];
 for(let i=0;picked.length<20;i++){let found=false;for(const q of queues){if(q[i]){picked.push(q[i]);found=true;if(picked.length===20)break;}}if(!found)break;}
 return shuffle(picked,rng).map(q=>decorate(q,rng));
}
function reward(s,key,amount){if(s.awarded[key])return 0;s.awarded[key]=true;s.points+=amount;return amount;}
function recordAnswer(s,id,correct,now=Date.now()){
 if(!questionById.has(id))throw new Error('Unknown question');
 const prev=s.answers[id];let earned=0;
 if(correct){earned+=reward(s,'q:'+id,10);if(prev&&!prev.correct)earned+=reward(s,'review:'+id,5);}
 s.answers[id]={correct,attempts:(prev?.attempts||0)+1,last:now,due:correct?now+3*86400000:now};
 return earned;
}
function completeQuiz(s,run,now=Date.now()){
 if(!run.questions?.length||run.answers.length!==run.questions.length)throw new Error('Incomplete assessment');
 if(run.finished)return run.result;
 const correct=run.answers.filter(a=>a.correct).length,score=Math.round(correct/run.questions.length*100);let bonus=0;
 if(run.lessonId){const old=s.lessons[run.lessonId];s.lessons[run.lessonId]={best:Math.max(old?.best||0,score),attempts:(old?.attempts||0)+1,last:now};if(score>=80)bonus=reward(s,'mastery:'+run.lessonId,40);}
 s.attempts.push({title:run.title,lessonId:run.lessonId||'',score,total:run.questions.length,date:now});s.attempts=s.attempts.slice(-200);
 run.finished=true;run.result={correct,total:run.questions.length,score,bonus,points:(run.earned||0)+bonus};return run.result;
}
function completeGame(s,id,mode,now=Date.now()){
 if(!lessonById.has(id)||!['match','classify'].includes(mode))throw new Error('Unknown game');
 const key=id+'-'+mode,old=s.games[key];s.games[key]={completed:true,attempts:(old?.attempts||0)+1,last:now};return reward(s,'game:'+key,20);
}
function mastery(s){return lessons.filter(l=>(s.lessons[l.id]?.best||0)>=80).length;}
function badges(s){
 const read=s.read.length,mastered=mastery(s),games=Object.values(s.games).filter(x=>x.completed).length,notes=Object.values(s.notes).filter(x=>x.trim().length>=20).length;
 const improvement=s.attempts.some((a,i)=>a.lessonId&&s.attempts.slice(0,i).some(p=>p.lessonId===a.lessonId&&p.score<a.score));
 const unitDone=lessons.some(l=>lessons.filter(x=>x.subject===l.subject&&x.unit===l.unit).every(x=>(s.lessons[x.id]?.best||0)>=80));
 return [
 {id:'start',icon:'✦',name:'مستكشف',detail:'أكمل قراءة درس واحد.',earned:read>=1},
 {id:'think',icon:'✧',name:'باحث صغير',detail:'دوّن ثلاث إجابات تأملية من عشرين حرفًا على الأقل.',earned:notes>=3},
 {id:'play',icon:'◇',name:'صانع الروابط',detail:'أكمل لعبتين تعليميتين.',earned:games>=2},
 {id:'master',icon:'★',name:'متقن درس',detail:'حقق 80٪ فأكثر في اختبار درس.',earned:mastered>=1},
 {id:'persist',icon:'↟',name:'مثابر',detail:'حسّن نتيجتك في محاولة لاحقة للدرس نفسه.',earned:improvement},
 {id:'unit',icon:'❖',name:'متقن وحدة',detail:'حقق 80٪ فأكثر في جميع دروس وحدة.',earned:unitDone},
 {id:'reader',icon:'❦',name:'رفيق المعرفة',detail:'أكمل قراءة عشرة دروس.',earned:read>=10},
 {id:'complete',icon:'✺',name:'متقن المنهج',detail:'حقق 80٪ فأكثر في اختبارات الدروس الـ32.',earned:mastered===32}
 ];
}
function studentReport(s,now=Date.now()){return {kind:'shaghaf-student-report',schema:2,book:BOOK,studentId:s.studentId,studentName:s.profile||'طالب',generatedAt:now,read:[...s.read],lessons:JSON.parse(JSON.stringify(s.lessons)),completedGames:Object.values(s.games).filter(x=>x.completed).length,notesCount:Object.values(s.notes).filter(x=>x.trim()).length,mistakes:[...questionById.keys()].filter(id=>s.answers[id]&&!s.answers[id].correct)};}
function validateReport(r){
 if(!r||r.kind!=='shaghaf-student-report'||r.schema!==2||r.book!==BOOK||typeof r.studentId!=='string'||!r.studentId.length)throw new Error('هذا الملف ليس تقرير طالب لهذه الطبعة.');
 const clean=cleanState({...r,profile:r.studentName,studentId:r.studentId,points:0,answers:{},notes:{},games:{},awarded:{}});
 return {...studentReport(clean,num(r.generatedAt,0,1e15)),completedGames:num(r.completedGames,0,64),notesCount:num(r.notesCount,0,64),mistakes:Array.isArray(r.mistakes)?[...new Set(r.mistakes.filter(id=>questionById.has(id)))]:[]};
}
global.ShaghafCore={BOOK,lessons,lessonById,questionById,freshState,cleanState,shuffle,decorate,makeLessonQuiz,makeUnitQuiz,recordAnswer,completeQuiz,completeGame,mastery,badges,studentReport,validateReport};
})(globalThis);
