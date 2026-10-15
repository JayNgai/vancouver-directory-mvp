/** Item 4 helper: Commons candidates for the 8 hand-verified businesses. Writes data/business-image-candidates.json. */
const fs = require('fs');
const path = require('path');
const UA = 'VancouverDirectory/1.0 (jayngai718@gmail.com) business image review';
const NAMES = ['A Bread Affair', 'Blue Water Cafe', 'Caffe La Tana', 'Caffè Cittadella', 'Coffee Central Roasting', 'Dhamaka', 'Medina Cafe', 'The Alibi Room'];
const ALLOWED = /^(CC0|Public domain|CC BY( \d\.\d)?|CC BY-SA( \d\.\d)?|PD)/i;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
(async () => {
  const out = {};
  for (const name of NAMES) {
    const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `"${name}" Vancouver`,
      gsrnamespace: '6', gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '1280'
    });
    const data = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
    const pages = Object.values((data.query && data.query.pages) || {});
    out[name] = pages.map((p) => {
      const info = (p.imageinfo || [])[0]; if (!info) return null;
      const m = info.extmetadata || {};
      const licence = strip(m.LicenseShortName && m.LicenseShortName.value);
      return { title: p.title, licence, allowed: ALLOWED.test(licence) && !/NC|ND/i.test(licence),
        artist: strip(m.Artist && m.Artist.value).slice(0, 120), landscape: info.width > info.height, thumb: info.thumburl };
    }).filter(Boolean);
    console.log(name + ': ' + out[name].length + ' hits; ' + out[name].filter((c) => c.allowed && c.landscape).map((c) => c.title.replace('File:', '').slice(0, 60)).slice(0, 3).join(' || '));
  }
  fs.writeFileSync(path.join(__dirname, '..', '..', 'data', 'business-image-candidates.json'), JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
