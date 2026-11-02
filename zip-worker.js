/* ZIP work runs locally in a worker. Only data files enter the importer. */
importScripts('./vendor/fflate.js');
const LIMIT = 256 * 1024 * 1024;
const allowed = /^(?:(?:[^/]+\/)?|(?:[^/]+\/)?papers\/[a-f0-9]{64}\/)(?:data\/(?:layout\.json|content\.json|original\.pdf|pages\/page-\d{4,6}\.svg)|paper-shelf-state\.json)$/;
self.onmessage = event => {
  try {
    let size = 0, count = 0;
    const seen = new Set();
    const files = fflate.unzipSync(new Uint8Array(event.data), {filter(info) {
      if (++count > 10000) throw new Error('ZIP 文件条目过多，请只打包阅读文件。');
      const path = info.name.replaceAll('\\','/');
      if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\0')) throw new Error('ZIP 内含不安全的文件路径。');
      if (!allowed.test(path)) return false;
      if (seen.has(path)) throw new Error('ZIP 内含重复的数据文件。');
      seen.add(path);
      if (!Number.isSafeInteger(info.originalSize) || info.originalSize < 0 || info.originalSize > 96*1024*1024) throw new Error('单个文件过大，请精简阅读包。');
      size += info.originalSize;
      if (size > LIMIT) throw new Error('解压后的阅读文件超过 256 MB，请拆分导入。');
      return true;
    }});
    self.postMessage({files},Object.values(files).map(value=>value.buffer));
  } catch(error) { self.postMessage({error:error.message || '无法解压这个 ZIP 文件。'}); }
};
