/* TEST DOUBLE untuk ProfilePhotoAnalyzer (file aslinya tidak ada di upload). Kontrak yang dipakai brain: analyze(img,{debug}) -> Promise|obj {kategori, sumber, confidence?} */
window.ProfilePhotoAnalyzer = { analyze: function (img) {
  var k = window.__stubCat;
  if (k === '__throw') return Promise.reject(new Error('x'));
  if (k === '__hang') return new Promise(function () {});
  if (k === '__null') return Promise.resolve(null);
  return Promise.resolve(k ? { kategori: k, sumber: 'stub', confidence: window.__stubConf == null ? 0.9 : window.__stubConf } : null);
} };
