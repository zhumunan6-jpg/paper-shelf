import {get,all,transact,defaultState} from './store.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true});
const COLORS = new Set(['yellow','blue','green','red']);
const LIMIT = 256 * 1024 * 1024;
const text = (value,max=200000) => typeof value === 'string' && value.length <= max;
const fail = message => { throw new Error(message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);

function unzip(file) {
  return new Promise(async(resolve,reject) => {
    let worker;
    try {
      const buffer = await file.arrayBuffer();
      worker = new Worker(new URL('./zip-worker.js',import.meta.url));
      const timer = setTimeout(()=>{worker.terminate();reject(new Error('解压超时，请精简 ZIP 包后重试。'));},60000);
      worker.onmessage = event => {clearTimeout(timer);worker.terminate();event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.files);};
      worker.onerror = () => {clearTimeout(timer);worker.terminate();reject(new Error('无法读取 ZIP，请确认文件完整后重试。'));};
      worker.postMessage(buffer,[buffer]);
    } catch(error) {worker?.terminate();reject(error);}
  });
}

function json(bytes,name) {
  if (!bytes || bytes.length > 32*1024*1024) fail(`缺少或无法读取 ${name}。请导入完整的阅读文件夹 ZIP。`);
  try {return JSON.parse(decoder.decode(bytes));} catch {fail(`${name} 不是有效的 UTF-8 JSON 文件。`);}
}

function validate(layout,content) {
  if (!Array.isArray(layout.pages) || !layout.pages.length || layout.pages.length>500) fail('论文页数无效或超过 500 页。');
  let wordCount=0;
  const paths=new Set();
  for (const [i,page] of layout.pages.entries()) {
    if (page.number!==i+1 || !finite(page.width) || !finite(page.height) || page.width<=0 || page.height<=0 || page.width>20000 || page.height>20000) fail('论文页面尺寸或页码无效。');
    if (!/^data\/pages\/page-\d{4,6}\.svg$/.test(page.image) || paths.has(page.image)) fail('页面图片路径无效。');
    paths.add(page.image);
    if (!Array.isArray(page.words) || (wordCount+=page.words.length)>250000) fail('论文文字数据过大或格式不完整。');
    for (const word of page.words) {
      if (!text(word.text,2000) || !Array.isArray(word.rect) || word.rect.length!==4 || !word.rect.every(finite) || word.rect[2]<word.rect[0] || word.rect[3]<word.rect[1] || word.rect.some(value=>Math.abs(value)>50000)) fail('论文文字位置数据无效。');
    }
  }
  if (!text(content.title,500) || !content.title.trim()) fail('阅读包缺少论文标题。');
  function checkRanges(ranges) {
    if (!Array.isArray(ranges) || !ranges.length || ranges.length>1000) fail('翻译缺少有效的文字位置。');
    let previous=-1;
    for (const range of ranges) {
      const page=layout.pages[range.page-1];
      if (!page || !Number.isInteger(range.page) || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start<0 || range.end<=range.start || range.end>page.words.length) fail('翻译与页面位置不匹配。');
      const key=(range.page-1)*1000000+range.start;
      if (key<previous) fail('翻译位置顺序无效。');
      previous=(range.page-1)*1000000+range.end;
    }
  }
  for (const key of ['units','vocabulary','terms']) {
    if (!Array.isArray(content[key]) || content[key].length>300000) fail(`阅读包缺少有效的 ${key} 数据。`);
    for (const entry of content[key]) {
      if (!text(entry.source) || !text(key==='terms'?entry.summary:entry.zh)) fail('预制译文或术语解释无效。');
      // Occurrences are separate matches; unlike unit ranges they need not be consecutive.
      if(key==='units') checkRanges(entry.ranges);
      else {if(!Array.isArray(entry.occurrences)||!entry.occurrences.length) fail('词语缺少位置数据。');for(const occurrence of entry.occurrences)checkRanges([occurrence]);}
      if(key==='terms' && (!Array.isArray(entry.sections)||entry.sections.length>100||entry.sections.some(section=>!text(section.title,2000)||!text(section.body))))fail('术语解释格式无效。');
    }
  }
  return wordCount;
}

export function sanitizeSVG(bytes) {
  const source=decoder.decode(bytes);
  if(/<!DOCTYPE|<!ENTITY/i.test(source))fail('页面图片含不支持的 XML 声明。');
  const xml=new DOMParser().parseFromString(source,'image/svg+xml');
  const root=xml.documentElement;
  if(root.localName!=='svg'||xml.querySelector('parsererror'))fail('页面 SVG 损坏。');
  const allowed=new Set(['svg','g','defs','path','use','image','rect','circle','ellipse','line','polyline','polygon','clipPath','mask','linearGradient','radialGradient','stop','pattern','text','tspan','title','desc','symbol']);
  for(const node of [root,...root.querySelectorAll('*')]) {
    if(node.namespaceURI!=='http://www.w3.org/2000/svg'||!allowed.has(node.localName)){node.remove();continue;}
    for(const attribute of [...node.attributes]) {
      const value=attribute.value.trim(), name=attribute.localName.toLowerCase();
      if(name.startsWith('on')||name==='base'||name==='src') {node.removeAttributeNode(attribute);continue;}
      if(name==='href' && !(value.startsWith('#') || (node.localName==='image' && /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value)))) {node.removeAttributeNode(attribute);continue;}
      if(/url\s*\(/i.test(value) && !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/.test(value)){node.removeAttributeNode(attribute);continue;}
      if(name==='style'&&/@|expression|https?:|javascript:|data:/i.test(value)) node.removeAttributeNode(attribute);
    }
  }
  return new Blob([new XMLSerializer().serializeToString(root)],{type:'image/svg+xml'});
}

function restoreState(value,id,wordCount,pageCount) {
  const state=defaultState(id);
  if(!value || value.version!==1)return state;
  if(Number.isInteger(value.page))state.page=Math.max(1,Math.min(pageCount,value.page));
  if(finite(value.fraction))state.fraction=Math.max(0,Math.min(1,value.fraction));
  if(['fit','1','1.5','2'].includes(value.zoom))state.zoom=value.zoom;
  if(typeof value.showTerms==='boolean')state.showTerms=value.showTerms;
  for(const [key,color] of Object.entries(value.marks||{}))if(/^(0|[1-9]\d*)$/.test(key)&&Number(key)<wordCount&&COLORS.has(color))state.marks[key]=color;
  if(Array.isArray(value.notes))state.notes=value.notes.slice(0,20000).filter(note=>text(note.text,10000)&&text(note.quote,20000)&&Number.isInteger(note.start)&&Number.isInteger(note.end)&&note.start>=0&&note.end>note.start&&note.end<=wordCount).map(note=>({id:crypto.randomUUID(),start:note.start,end:note.end,text:note.text,quote:note.quote,page:Math.max(1,Math.min(pageCount,Number(note.page)||1)),createdAt:finite(note.createdAt)?note.createdAt:Date.now()}));
  return state;
}

export async function importArchive(file,report=()=>{},replaceRecords=false) {
  if(file.size>LIMIT)fail('ZIP 超过 256 MB，请只打包阅读所需文件或分篇导入。');
  report('正在本机解压…');
  const files=await unzip(file);
  const normalized=Object.fromEntries(Object.entries(files).map(([path,bytes])=>[path.replaceAll('\\','/'),bytes]));
  const layouts=Object.keys(normalized).filter(path=>/(?:^|\/)data\/layout\.json$/.test(path));
  if(!layouts.length)fail('没有找到 data/layout.json。请压缩完整的阅读文件夹，不要只选择 PDF 或 HTML。');
  let imported=0,skipped=0;
  for(const [position,path] of layouts.entries()) {
    report(`正在检查论文 ${position+1} / ${layouts.length}…`);
    const prefix=path.slice(0,-'data/layout.json'.length);
    const layout=json(normalized[path],'layout.json'),content=json(normalized[`${prefix}data/content.json`],'content.json');
    const wordCount=validate(layout,content);
    const pdf=normalized[`${prefix}data/original.pdf`];
    if(!pdf||decoder.decode(pdf.subarray(0,5))!=='%PDF-')fail('阅读包缺少有效的原始 PDF。');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pdf))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(layout.sha256 && layout.sha256!==digest)fail('PDF 与页面数据的校验值不一致，请重新打包原始阅读文件夹。');
    const id=digest,existing=await get('papers',id);
    if(existing&&!replaceRecords){skipped++;continue;}
    const assets=[];
    for(const page of layout.pages) {
      const image=normalized[`${prefix}${page.image}`];
      if(!image)fail(`缺少第 ${page.number} 页的图片，请重新打包完整文件夹。`);
      assets.push({id:`${id}/${page.image}`,blob:sanitizeSVG(image)});
    }
    assets.push({id:`${id}/data/original.pdf`,blob:new Blob([pdf],{type:'application/pdf'})});
    const paper={id,title:content.title,pages:layout.pages,content,bytes:assets.reduce((sum,asset)=>sum+asset.blob.size,0),importedAt:existing?.importedAt||Date.now()};
    const stateBytes=normalized[`${prefix}paper-shelf-state.json`];
    const state=restoreState(stateBytes?json(stateBytes,'paper-shelf-state.json'):null,id,wordCount,layout.pages.length);
    await transact(['papers','assets','states'],stores=>{stores.papers.put(paper);for(const asset of assets)stores.assets.put(asset);stores.states.put(state);});
    imported++;
  }
  return {imported,skipped};
}

export async function backupLibrary(paperIds) {
  const papers=(await all('papers')).filter(paper=>!paperIds||paperIds.includes(paper.id));
  if(!papers.length)fail('书架里还没有论文。');
  const entries={};
  let total=0;
  for(const paper of papers) {
    const prefix=`papers/${paper.id}/`;
    const layout={version:1,sha256:paper.id,pages:paper.pages};
    entries[`${prefix}data/layout.json`]=encoder.encode(JSON.stringify(layout));
    entries[`${prefix}data/content.json`]=encoder.encode(JSON.stringify(paper.content));
    const state=await get('states',paper.id)||defaultState(paper.id);
    entries[`${prefix}paper-shelf-state.json`]=encoder.encode(JSON.stringify({...state,version:1}));
    for(const path of [...paper.pages.map(page=>page.image),'data/original.pdf']) {
      const asset=await get('assets',`${paper.id}/${path}`);
      if(!asset)fail('本地页面文件缺失，请重新导入论文后再备份。');
      total+=asset.blob.size;
      if(total>LIMIT)fail('完整备份超过 256 MB，请从每篇论文的菜单分别备份。');
      entries[`${prefix}${path}`]=new Uint8Array(await asset.blob.arrayBuffer());
    }
  }
  // Store rather than recompress: predictable memory use and fast mobile export.
  return new Blob([window.fflate.zipSync(entries,{level:0})],{type:'application/zip'});
}
