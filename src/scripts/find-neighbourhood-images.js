/**
 * Item 3 helper: finds candidate Wikimedia Commons photos per neighbourhood and keeps only
 * ones whose licence allows commercial use and modification, and that are landscape.
 * Writes data/neighbourhood-image-candidates.json for manual review. Nothing is written to the DB here.
 */
const fs = require('fs');
const path = require('path');

const UA = 'VancouverDirectory/1.0 (jayngai718@gmail.com) editorial image review';
const NEIGHBOURHOODS = [
  ['Gastown', 'Gastown Vancouver'], ['Kitsilano', 'Kitsilano Vancouver'],
  ['Downtown Vancouver', 'Downtown Vancouver Robson Street'], ['Yaletown', 'Yaletown Vancouver'],
  ['West End', 'West End Vancouver Denman'], ['Mount Pleasant', 'Mount Pleasant Vancouver'],
  ['Commercial Drive', 'Commercial Drive Vancouver'], ['Strathcona', 'Strathcona Vancouver'],
  ['Chinatown', 'Vancouver Chinatown'], ['Coal Harbour', 'Coal Harbour Vancouver'],
  ['Point Grey', 'Point Grey Vancouver'], ['Kerrisdale', 'Kerrisdale Vancouver'],
  ['Marpole', 'Marpole Vancouver'], ['South Granville', 'South Granville Vancouver'],
  ['False Creek', 'False Creek Vancouver'], ['Fairview', 'Fairview Vancouver'],
  ['Grandview-Woodland', 'Grandview-Woodland Vancouver'], ['Hastings-Sunrise', 'Hastings-Sunrise Vancouver'],
  ['Killarney', 'Killarney Vancouver'], ['Oakridge', 'Oakridge Vancouver'],
  ['Renfrew-Collingwood', 'Renfrew-Collingwood Vancouver'], ['Sunset', 'Sunset Vancouver'],
  ['Victoria-Fraserview', 'Victoria-Fraserview Vancouver']
];
const ALLOWED = /^(CC0|Public domain|CC BY( \d\.\d)?|CC BY-SA( \d\.\d)?|PD)/i;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function api(params) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const out = {};
  for (const [name, query] of NEIGHBOURHOODS) {
    const data = await api({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '12',
      prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1280'
    });
    const pages = Object.values((data.query && data.query.pages) || {});
    out[name] = pages.map((p) => {
      const info = (p.imageinfo || [])[0];
      if (!info) return null;
      const meta = info.extmetadata || {};
      const licence = strip(meta.LicenseShortName && meta.LicenseShortName.value);
      return {
        title: p.title, licence,
        allowed: ALLOWED.test(licence) && !/NC|ND/i.test(licence),
        artist: strip(meta.Artist && meta.Artist.value).slice(0, 120),
        landscape: info.width > info.height, width: info.width, height: info.height,
        thumb: info.thumburl, page: info.descriptionurl
      };
    }).filter(Boolean).filter((c) => c.allowed && c.landscape && /\.(jpe?g|png)$/i.test(c.title));
    console.log(`${name}: ${out[name].length} usable`);
  }
  const file = path.join(__dirname, '..', '..', 'data', 'neighbourhood-image-candidates.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  console.log('wrote', file);
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
