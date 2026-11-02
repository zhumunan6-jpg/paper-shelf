const DB_NAME = 'paper-shelf-local-v1';
let connection;

export async function db() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['papers', 'assets', 'states', 'settings']) request.result.createObjectStore(name, {keyPath:'id'});
    };
    request.onsuccess = () => { request.result.onversionchange = () => {request.result.close(); connection = null;}; resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他书架页面，再重新打开。'));
  });
  return connection;
}

export async function get(store, id) {
  const database = await db();
  return new Promise((resolve,reject) => {
    const request = database.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function all(store) {
  const database = await db();
  return new Promise((resolve,reject) => {
    const request = database.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function transact(names, callback) {
  const database = await db();
  return new Promise((resolve,reject) => {
    const transaction = database.transaction(names, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('本地保存已中止，请重试。'));
    try { callback(Object.fromEntries(names.map(name => [name,transaction.objectStore(name)]))); }
    catch(error) { transaction.abort(); reject(error); }
  });
}

export const put = (store,value) => transact([store], stores => stores[store].put(value));

export function defaultState(id) {
  return {id,page:1,fraction:0,zoom:'fit',showTerms:true,marks:{},notes:[],updatedAt:Date.now()};
}

export async function removePaper(id) {
  const paper = await get('papers',id);
  if (!paper) return;
  await transact(['papers','states','assets'], stores => {
    stores.papers.delete(id); stores.states.delete(id);
    for (const path of [...paper.pages.map(page=>page.image),'data/original.pdf']) stores.assets.delete(`${id}/${path}`);
  });
}

export const clearLibrary = () => transact(['papers','states','assets'], stores => {
  stores.papers.clear(); stores.states.clear(); stores.assets.clear();
});
