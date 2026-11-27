import { describe, expect, it } from 'vitest';
import { RECORDING_MANIFEST, PHYSICAL_RECORDING_MANIFEST, REVIEW_REF, VIEW_OF_FEED, manifestCandidatesFor, mergeReviewedViews } from '../../src/journey/recordingManifest';
import { allocateCityRecordings } from '../../src/journey/recordingIdentity';
import { cityFeedIds } from '../../src/journey/cityContext';
import { ALL_FEEDS } from '../../src/journey/feeds';
import { CITIES } from '../../src/journey/globe';
import extraRows from '../../public/media/city-sources-extra.json';
import savCredits from '../../public/media/city-savannah-additional/CREDITS.txt?raw';
import palCredits from '../../public/media/city-palmdale-additional/CREDITS.txt?raw';
import mexicoCredits from '../../public/media/city-mexico-city-pexels-28710088/CREDITS.txt?raw';

const importedRows = extraRows.filter(r => 'admissionManifestSha256' in r);
const expectedTotal = 86 + importedRows.length;
const expectedNY = 14 + importedRows.filter(r=>r.cityId==='new-york').length;
describe('recordingManifest (legacy and reviewed imported views)', () => {
  it('has all legacy and imported entries with unique feeds, reviewed view ids and original asset keys', () => {
    expect(RECORDING_MANIFEST).toHaveLength(expectedTotal + 6);
    expect(new Set(RECORDING_MANIFEST.map((c) => c.feedId)).size).toBe(expectedTotal + 6);
    expect(new Set(RECORDING_MANIFEST.map((c) => c.reviewedView?.viewId)).size).toBe(expectedTotal);
    expect(new Set(RECORDING_MANIFEST.map((c) => c.originalAssetKey)).size).toBe(expectedTotal + 6);
    expect(Object.keys(VIEW_OF_FEED)).toHaveLength(expectedTotal);
    // view ids are curated, not derived from the feed id
    for (const c of RECORDING_MANIFEST) expect(c.reviewedView!.viewId).not.toBe(c.feedId);
  });

  it('owns exactly the feeds each city owns (CITIES), all playable in ALL_FEEDS', () => {
    const ids = new Set(ALL_FEEDS.map((f) => f.id));
    for (const city of CITIES) {
      const got = manifestCandidatesFor(city.id).map((c) => c.feedId).sort();
      expect(got).toEqual([...cityFeedIds(city)].sort());
      for (const f of got) expect(ids.has(f!)).toBe(true);
    }
    expect(new Set(RECORDING_MANIFEST.map((c) => c.cityId)).size).toBe(CITIES.length);
  });

  it('keeps the same NASA page as two distinct originals and views (Palmdale)', () => {
    const [a, b] = manifestCandidatesFor('palmdale');
    expect(a.provenance.sourceUrl).toBe(b.provenance.sourceUrl);
    expect(a.originalAssetKey).not.toBe(b.originalAssetKey);
    expect(a.originalAssetKey).toMatch(/RollOut_Taxi_7/);
    expect(b.originalAssetKey).toMatch(/PreFlight_cont_8/);
    expect(a.reviewedView!.viewId).not.toBe(b.reviewedView!.viewId);
    const r = allocateCityRecordings('palmdale', 2, manifestCandidatesFor('palmdale'));
    expect(r.status).toBe('ready');
  });

  it('uses canonical MEVA camera views and does not invent original hashes for core clips', () => {
    const meva = PHYSICAL_RECORDING_MANIFEST.filter((c) => c.provenance.publisher === 'MEVA');
    expect(meva.map((c) => c.reviewedView!.viewId).sort()).toEqual([
      'butlerville-meva-g301-dock', 'butlerville-meva-g326', 'butlerville-meva-g328', 'butlerville-meva-g330-gymnasium', 'butlerville-meva-g341',
      'butlerville-meva-g421-cafe', 'butlerville-meva-g423-school-hall', 'butlerville-meva-g424', 'butlerville-meva-g436-road-junction',
      'butlerville-meva-g505-canopy-roadside', 'butlerville-meva-g639-passage', 'meva-mutc-g299', 'meva-mutc-g329', 'meva-mutc-g331', 'meva-mutc-g340', 'meva-mutc-g419', 'meva-mutc-g420', 'meva-mutc-g508', 'meva-mutc-g638']);
    // full source file URLs/keys (never loop hashes); camera ids come from the source file names
    for (const [feed, cam] of [['m03', 'G301'], ['m07', 'G639'], ['covered-road', 'G505']] as const) {
      const c = meva.find((x) => x.feedId === feed)!;
      expect(c.originalAssetUrl).toMatch(new RegExp(`^https://mevadata-public-01\\.s3\\.amazonaws\\.com/drop-5-mevid/.*\\.${cam}\\.r13\\.avi$`));
      expect(c.originalAssetKey).toContain(`.${cam}.`);
      expect(c.originalSha256).toBeUndefined();
    }
    expect(manifestCandidatesFor('butlerville')).toHaveLength(25);
    // original hashes only where the packet declares the SOURCE .avi hash (never a loop hash); G507 (hold) is absent
    const withHash = ['m04', 'm05', 'city-butlerville-school-hall', 'city-butlerville-cafe', 'city-butlerville-stairwell', 'city-butlerville-classroom', 'city-butlerville-courtyard', 'city-butlerville-bus-interior',
      'city-butlerville-gym-reverse', 'city-butlerville-stair-corridor', 'city-butlerville-roadside', 'city-butlerville-upper-stairwell'];
    for (const c of RECORDING_MANIFEST.filter((x) => !x.feedId!.startsWith('city-') && !withHash.includes(x.feedId!))) expect(c.originalSha256).toBeUndefined();
    for (const held of ['G507', 'G336', 'G506']) expect(RECORDING_MANIFEST.some((c) => c.originalAssetKey.includes(`.${held}.`))).toBe(false);
    // same building, DIFFERENT physical cameras: each is its own view, never a crop/variant of G330 / G419
    const ids = new Set(RECORDING_MANIFEST.map((c) => c.reviewedView!.viewId));
    for (const v of ['meva-mutc-g299', 'butlerville-meva-g330-gymnasium', 'meva-mutc-g420', 'meva-mutc-g419']) expect(ids.has(v)).toBe(true);
    const want: Record<string, [string, string, string]> = {
      m04: ['G436', 'butlerville-meva-g436-road-junction', '73642DDB31E22A4D903E021A0A30F145FD1874C0D1D4B0F9D6A2F8CF0C2579CE'],
      m05: ['G330', 'butlerville-meva-g330-gymnasium', 'BA6CED055FE46655972C3E771DE09712C41E1E1BD3128FF23F6D94F6697ED9C4'],
      'city-butlerville-school-hall': ['G423', 'butlerville-meva-g423-school-hall', 'BA4B0862A33BE7BD4DEDEB3094CF650B8E52F7DDF4283C7B9110FC84B0687309'],
      'city-butlerville-cafe': ['G421', 'butlerville-meva-g421-cafe', '00E2114E41B1A10559D4359A86030FAEE22EE48752B328AA2466A5D2584BA0F3'],
      'city-butlerville-stairwell': ['G419', 'meva-mutc-g419', 'B47D7C6E71FE0646493DFBDC18FCBF2FEFA5C14269F0FF7D4F16F86A7B313308'],
      'city-butlerville-classroom': ['G508', 'meva-mutc-g508', '10D0C4A0AB4BFBE96D79952A38D20513B92CE1BD71359A1E9F57294AFC5392CD'],
      'city-butlerville-gym-reverse': ['G299', 'meva-mutc-g299', '2EE0ED03AA9BAD3325AC3375E626C0E8E42491C9E23A864607DA3955CF8C1B58'],
      'city-butlerville-stair-corridor': ['G329', 'meva-mutc-g329', '8DB8B56EF19359D899B1F0C79F8EEBF37C7CBF3A1482033D8119FF8CFEDF7A28'],
      'city-butlerville-roadside': ['G340', 'meva-mutc-g340', 'E2F591F2C801B439CDF8E86C5B8C8A164FB034746D5DCD537D15CAE0D9D71F86'],
      'city-butlerville-upper-stairwell': ['G420', 'meva-mutc-g420', '72355632DA411DA7110FACF951F6469C3A4ECF23DED279C37843D9587A868B68'],
      'city-butlerville-bus-interior': ['G331', 'meva-mutc-g331', '228A2BAB02690A700F5D0B357B0A5F50C8AC35F189058367D06429221C823654'],
      'city-butlerville-courtyard': ['G638', 'meva-mutc-g638', '31CE804E1792E0CC8E042B4C092A2938CB263C4C84EB2ED15EE359D701A12E4C'],
    };
    for (const [feed, [cam, view, sha]] of Object.entries(want)) {
      const c = meva.find((x) => x.feedId === feed)!;
      expect(c.reviewedView!.viewId).toBe(view);
      expect(c.reviewedView!.reviewRef).toMatch(/^visual-r51-butlerville-g\d+$/);
      expect(c.originalAssetUrl).toContain(`.${cam}.r13.avi`);
      expect(c.originalSha256!.toUpperCase()).toBe(sha);
    }
  });

  it('every city allocates without conflicts and is short of 78 (and of 78) by exactly its missing views', () => {
    for (const city of CITIES) {
      const own = manifestCandidatesFor(city.id);
      for (const required of [78, 78]) {
        const r = allocateCityRecordings(city.id, required, own);
        expect(r.status).toBe('insufficient');
        if (r.status === 'insufficient') {
          expect(r.available).toBe(own.length);
          expect(r.deficit).toBe(required - own.length);
        }
      }
    }
  });

  it('Savannah/Palmdale additional: originalSha256 is the true original, trimmed derivative kept distinct; correct view', () => {
    const want = {
      'city-savannah-additional': ['8FD1F6B9D8F932BB8C04CDC1747D94DA66F8B67597DA1C9D640A06FC690427E0', '7E9274FF493BC495555B103691D637075D76ABCA1973C18CCC0ACC3AD90C4900', savCredits],
      'city-palmdale-additional': ['9200B39F53F4FF63DAFD9187FD8550FD8032D2EEB4B6082333FA3D1B0EDDFC2A', '7A3E3EF4A04E225A356CB4B74120417B4BBE8664C6A9BE3B8563D2153FF34CEB', palCredits],
    } as const;
    for (const [feedId, [orig, derived, credits]] of Object.entries(want)) {
      const row = (extraRows as { feedId: string; originalSha256: string; trimmedDerivativeSha256?: string }[]).find((r) => r.feedId === feedId)!;
      expect(row.originalSha256.toUpperCase()).toBe(orig);
      expect(row.trimmedDerivativeSha256!.toUpperCase()).toBe(derived);
      expect(orig).not.toBe(derived);
      expect(credits).toContain(`Original SHA256: ${orig}`);
      expect(credits).toContain(`Trimmed derivative SHA256: ${derived}`);
      const cand = RECORDING_MANIFEST.find((c) => c.feedId === feedId)!;
      expect(cand.originalSha256!.toUpperCase()).toBe(orig); // identity evidence = original, never the derivative
      expect(cand.originalSha256!.toUpperCase()).not.toBe(derived);
    }
    expect(VIEW_OF_FEED['city-palmdale-additional']).toBe('palmdale-preflight-instrument-cabin');
  });

  it('Paris arc views: explicit views/refs, original rendition URL+hash kept apart from loop/poster hashes, old aliases intact', () => {
    const paris = manifestCandidatesFor('paris');
    expect(paris).toHaveLength(8);
    const want = {
      'city-paris-arc-4025': ['paris-arc-rooftop-wide-day', 'visual-r51-paris-arc-4025', 'https://assets.mixkit.co/videos/4025/4025-720.mp4', 'e4de0ad954122fe33d03d5c7eb17d40fbeb91518169ecd990f405da6627e7521', '65388550010aac6c6bd120f8adb0de80a99309e7d827bb5a00d7c0f9df3a9035'],
      'city-paris-arc-4179': ['paris-arc-ground-oblique-night', 'visual-r51-paris-arc-4179', 'https://assets.mixkit.co/videos/4179/4179-720.mp4', 'ecd42351165e745700a6b2c15324a28f5b95921088e5bfa5e30b5a415dd5ba28', 'bfb23e12f6f11555341849774b05985da6cd629a9cab8e58610c3c5d632eafea'],
    } as const;
    for (const [feed, [view, ref, url, orig, loop]] of Object.entries(want)) {
      const c = paris.find((x) => x.feedId === feed)!;
      expect(c.reviewedView).toEqual({ viewId: view, reviewRef: ref });
      expect(c.originalAssetKey).toBe(url); expect(c.originalAssetUrl).toBe(url);
      expect(c.originalSha256).toBe(orig); expect(c.originalSha256).not.toBe(loop);
      expect(c.provenance.sourceUrl).toMatch(/^https:\/\/mixkit\.co\/free-stock-video\//);
    }
    // the five earlier Paris views keep their ids and page-URL asset keys
    expect(paris.slice(0, 5).map((c) => c.feedId)).toEqual(['city-paris', 'city-paris-street', 'city-paris-river', 'city-paris-path', 'city-paris-eiffel']);
    expect(allocateCityRecordings('paris', 8, paris).status).toBe('ready');
    // source2: Paris Pexels night intersection (appended last; folder/feed id is city-paris-night-intersection)
    expect(paris[7].feedId).toBe('city-paris-night-intersection');
    expect(paris[7].reviewedView).toEqual({ viewId: 'pexels-12329724', reviewRef: 'visual-r51-paris-12329724' });
    expect(paris[7].originalAssetKey).toBe('pexels-12329724/12329724-uhd_3840_2160_25fps.mp4');
    expect(paris[7].originalSha256).toBe('EEE29E8908CB6A4A3D5D31A3983EBD3C541007662095F2B63C59F887E3C351D5');
  });

  it('New York owns fourteen distinct views; the R51 additions keep their original hashes and page keys', () => {
    const ny = manifestCandidatesFor('new-york');
    expect(ny.slice(0,14).map((c) => c.feedId)).toEqual(['city-new-york', 'city-new-york-additional', 'city-new-york-4086', 'city-new-york-4272', 'city-new-york-4338',
      'city-new-york-pexels-13418064', 'city-new-york-pexels-14306101', 'city-new-york-pexels-34118767', 'city-new-york-pexels-5688094', 'city-new-york-pexels-5636797', 'city-new-york-pexels-4970648', 'city-new-york-pexels-4793612', 'city-new-york-pexels-9994126', 'city-new-york-pexels-5123483']);
    expect(new Set(ny.map((c) => c.reviewedView!.viewId)).size).toBe(expectedNY);
    const last = ny[8];
    expect(last.reviewedView).toEqual({ viewId: 'new-york-elevated-waterfront-park-night', reviewRef: 'visual-r51-nyc-pexels-5688094' });
    expect(last.originalSha256).toBe('d62a8931197fec1ce48cc7b01e8bebeeac64324d93ec03234cec9268e1641de6');
    expect(last.originalAssetKey).toBe('pexels-5688094/5688094-uhd_3840_2160_30fps.mp4');
    const want: Record<string, [string, string]> = {
      'city-new-york-4086': ['new-york-brooklyn-bridge-traffic', 'afe8f32be8348b06a82f0169cfde08792ef3fb10e052d2a46056bdf0afad14f6'],
      'city-new-york-4272': ['new-york-intersection-traffic-light', '8d94d244d69e49abcba0f3d8f412674da20a5fbaafe8729855161af6060ac7ee'],
      'city-new-york-4338': ['new-york-manhattan-junction-night', '9d2160f09abc7523d6dc64b9772e406a1b3df33dcb302a7fea6a95c318c0504d'],
      'city-new-york-pexels-13418064': ['new-york-flatiron-traffic-pedestrians', 'cf09dd4209c1ce3373e93210fb58574b07df55d61b9a93fc2854c14ff3077493'],
      'city-new-york-pexels-14306101': ['new-york-brooklyn-waterfront', 'e3453333b877e7f2ee2cf7f9875fd5711097207ab885b138ac70238912e11bb8'],
      'city-new-york-pexels-34118767': ['new-york-lincoln-tunnel-approach', 'c96f3d0ff8ae622a543aeb72a0a2ade649621d0ac1b6a1c4c0618f91fd32ef5d'],
    };
    for (const [feed, [view, sha]] of Object.entries(want)) {
      const c = ny.find((x) => x.feedId === feed)!;
      expect(c.reviewedView!.viewId).toBe(view);
      expect(c.originalSha256).toBe(sha);
      expect(c.originalAssetKey).toMatch(/^https:\/\/(mixkit\.co\/free-stock-video|www\.pexels\.com\/video)\//);
    }
    expect(allocateCityRecordings('new-york', 14, ny).status).toBe('ready');
    // rejected/held NYC items are absent
    expect(RECORDING_MANIFEST.some((c) => /-(4087|4181|4334)\/?$/.test(c.originalAssetKey))).toBe(false);
  });

  it('Mexico City owns three distinct views; the Reforma source keeps its original hash apart from loop/poster and its disclosures', () => {
    const mx = manifestCandidatesFor('mexico-city');
    expect(mx.map((c) => c.feedId)).toEqual(['city-mexico-city', 'city-mexico-city-additional', 'city-mexico-city-pexels-28710088']);
    expect(new Set(mx.map((c) => c.reviewedView!.viewId)).size).toBe(3);
    expect(mx.map((c) => c.reviewedView!.viewId)).toEqual(['mexico-city-rooftop', 'mexico-city-cathedral', 'mexico-city-reforma-avenue-traffic']);
    const c = mx[2];
    expect(c.reviewedView).toEqual({ viewId: 'mexico-city-reforma-avenue-traffic', reviewRef: 'visual-r51-mexico-pexels-28710088' });
    expect(c.originalAssetKey).toBe('pexels-28710088/12457874_1920_1080_24fps.mp4');
    expect(c.originalAssetUrl).toBe('https://videos.pexels.com/video-files/28710088/12457874_1920_1080_24fps.mp4');
    expect(c.originalSha256).toBe('fbdca7f555dcecd6f8c93ef2bc4fb22afdf760628ebb6ba20e5b93abd1afedb1');
    expect(c.provenance.sourceUrl).toBe('https://www.pexels.com/video/bustling-traffic-on-reforma-avenue-in-mexico-city-28710088/');
    const row = (extraRows as Record<string, unknown>[]).find((r) => r.feedId === 'city-mexico-city-pexels-28710088')!;
    expect(row.loopSha256).toBe('f00780870aa5353a0230971f85ca7b67edaac6a2fc20536f34c2d519ce651612');
    expect(row.posterSha256).toBe('e313215e7a1c94b5f37162d9a7fe69c30e1ce51dfe820d9a40244fbf445b813e');
    expect(row.loopSha256).not.toBe(row.originalSha256); // loop derivative never doubles as the original
    expect(row.provenanceLevel).toBe('STOCK_PUBLISHER_LOCATION');
    expect(row.exactCameraCoordinatesVerified).toBe(false);
    expect(String(row.loopNote)).toMatch(/not live/i); expect(String(row.loopNote)).toMatch(/not certified seamless/i);
    expect(mexicoCredits).toMatch(/Not claimed seamless/); expect(mexicoCredits).toMatch(/0\.5 s/); expect(mexicoCredits).toMatch(/exact camera coordinates unverified/);
    expect(mexicoCredits).toContain('fbdca7f555dcecd6f8c93ef2bc4fb22afdf760628ebb6ba20e5b93abd1afedb1');
    expect(allocateCityRecordings('mexico-city', 3, mx).status).toBe('ready');
    const short = allocateCityRecordings('mexico-city', 4, mx);
    expect(short.status).toBe('insufficient');
    if (short.status === 'insufficient') expect(short.deficit).toBe(1);
  });

  it('Sydney owns three distinct views with original and derivative provenance separated', () => {
    const city = manifestCandidatesFor('sydney');
    expect(city).toHaveLength(3);
    expect(new Set(city.map(c => c.reviewedView!.viewId)).size).toBe(3);
    const c = city.find(c => c.feedId === 'city-sydney-highway-night')!;
    expect(c.reviewedView!.viewId).toBe('sydney-elevated-highway-night');
    expect(c.originalAssetKey).toBe('pexels-16073006/16073006-hd_1920_1080_25fps.mp4');
    expect(c.originalSha256).toBe('AA1598EC9B8372AB1372EC44E576E11FDF533295323269B7245C818A7F6D819C');
    const row = extraRows.find(r => r.feedId === c.feedId)!;
    expect(row.loopSha256).toBe('899B63127E43740AADF50ADAA5328D0209BF2EEE34B2AE57105AC119A2CAE7D2');
    expect(row.posterSha256).toBe('3E3C4700246088BA52CC8E968DA8F3F9D4F8565A6C344B2D1671197EB5C73B1E');
    expect(row.originalSha256).not.toBe(row.loopSha256);
    expect(row.provenanceLevel).toBe('STOCK_PUBLISHER_LOCATION');
    expect(row.exactCameraCoordinatesVerified).toBe(false);
    expect(row.loopNote).toMatch(/not live/);
    expect(row.loopNote).toMatch(/not certified seamless/);
    expect(allocateCityRecordings('sydney', 3, city).status).toBe('ready');
    expect(allocateCityRecordings('sydney', 4, city).status).toBe('insufficient');
  });


  it('R52 Tokyo and New York batch binds reviewed originals, derivatives and finite city capacity', () => {
    const expected = [
    {
        "feed": "city-tokyo-mixkit-4383",
        "city": "tokyo",
        "view": "tokyo-rainbow-bridge-night-overlook",
        "original": "c2860221d84538933c057469e071bde528991c35a19b39d745f9b12b76c2d2a9",
        "loop": "7284e7b20cc35b1a71d6f3abccab168b90a91725552c68ea5481de773fa005e1",
        "poster": "f5218509fba27f7834bcd14472f179f4d760b07879c46d84b34e5114714e51e0"
    },
    {
        "feed": "city-tokyo-mixkit-4309",
        "city": "tokyo",
        "view": "tokyo-tower-skyline-day-overlook",
        "original": "c7e33b4a8cfed425a05971ae3fe5dfa5f06152223be7a463d4c39370a78a6fe8",
        "loop": "c9277cf6e23c927998544a431a1f99c52382d54b9d94488116e1995c6c68e00a",
        "poster": "c92e0b3e91e2c1263f07d6ab0147693829fd133242cc418d584ede5ceb038717"
    },
    {
        "feed": "city-tokyo-mixkit-4445",
        "city": "tokyo",
        "view": "tokyo-industrial-container-yard-overlook",
        "original": "ee0787660a713d0a9d219ca637aa08c910214441c27077b3cf942bd7ad6ff69d",
        "loop": "e3ad08271d1a0ede838446f9ebddd89517fb51943a2c41852b18b92b1f8bedab",
        "poster": "3aba8d8af47f784636267fbd7319c81219432841c171d5d797d57a393198ca33"
    },
    {
        "feed": "city-new-york-pexels-5636797",
        "city": "new-york",
        "view": "new-york-brooklyn-bridge-park-promenade-bridge-night",
        "original": "53c8483d68f4cb07136434543a4e15f42f1152e876a8e6dd5a0780aa01c24098",
        "loop": "964993b715c7e36c1ec0758510c2b6ea9af71e4d9034c772c987dc061499b3f6",
        "poster": "2d08d960ee9f7a3436a71e4b619c842ba3bac95b26a6e509c628c43a484edf09"
    }
];
    expect(manifestCandidatesFor('tokyo')).toHaveLength(5);
    expect(manifestCandidatesFor('new-york')).toHaveLength(expectedNY);
    for (const e of expected) {
      const c = RECORDING_MANIFEST.find(c => c.feedId === e.feed)!;
      const row = extraRows.find(r => r.feedId === e.feed)!;
      expect(c.cityId).toBe(e.city);
      expect(c.reviewedView!.viewId).toBe(e.view);
      expect(c.originalSha256).toBe(e.original);
      expect(row.loopSha256).toBe(e.loop);
      expect(row.posterSha256).toBe(e.poster);
      expect(row.originalSha256).not.toBe(row.loopSha256);
      expect(row.exactCameraCoordinatesVerified).toBe(false);
      expect(row.loopNote).toMatch(/not live/);
    }
    for (const [city, count] of [['tokyo', 5], ['new-york', 14]] as const) {
      expect(allocateCityRecordings(city, count, manifestCandidatesFor(city)).status).toBe('ready');
      expect(allocateCityRecordings(city, 78, manifestCandidatesFor(city)).status).toBe('insufficient');
    }
    expect(RECORDING_MANIFEST.some(c => /4452|34118774/.test(c.originalAssetKey))).toBe(false);
  });


  it('R52 second New York batch retains exact approved originals and derivative provenance', () => {
    const expected = [
    [
        "city-new-york-pexels-4970648",
        "new-york-lower-manhattan-skyline-waterfront-promenade-day",
        "429286ef856cb9bb9fde6522895f3e7d6dcf5ddcea6da8f4d663ac20ffbef6ea",
        "aafb39f1fa9750202b3060a147752aa1e6cf77fe8e4134ac8ff18b15bd5e941d",
        "2927816cbfff9629633952c9aed09dd3466f4c23fdafd47de5bf82c47de45c3c"
    ],
    [
        "city-new-york-pexels-4793612",
        "new-york-manhattan-bridge-east-river-rocks-day",
        "de872cd3bc9662322e4dcbc21561d54645ee7686488aa00323666379080bad65",
        "a911ce5704d6d25b9ff0a4bb050a8b29fbb56461c384f62515366e58d6e71bcd",
        "a251b846f7ed255b74b859bde77a44c7fba9a69e575909dd4e173cf64691e711"
    ],
    [
        "city-new-york-pexels-9994126",
        "new-york-lower-manhattan-high-rise-hudson-sunset",
        "d7e8f9e5f0a2367fe6cd09ff08baf8a94e94024855bc2d4bfaac2ec5db954ed1",
        "fc7d180899afbcf9649952a1b550d1f1a1f37b6840dcc5c897b437fa01719460",
        "6b1bd2639643854896a68b366f7a33371eb78d348a15614b3ad8885f73d96db6"
    ],
    [
        "city-new-york-pexels-5123483",
        "new-york-east-river-water-level-manhattan-brooklyn-bridges",
        "b015bffc78cdd274a1ee16885ed60df695785594868400ce86278babb964b9a5",
        "a353a510ce45c1a4352f8255cc26922aa44540390be59e096b179db50519a0de",
        "a5efc909c3d5fd9ae98340d0654a3ff3daca178531476f42fddc743fe0fd79c9"
    ]
];
    for (const [feed, view, original, loop, poster] of expected) {
      const c = RECORDING_MANIFEST.find(c => c.feedId === feed)!;
      const row = extraRows.find(r => r.feedId === feed)!;
      expect(c.cityId).toBe('new-york');
      expect(c.reviewedView!.viewId).toBe(view);
      expect(c.originalSha256).toBe(original);
      expect(row.loopSha256).toBe(loop);
      expect(row.posterSha256).toBe(poster);
      expect(row.originalSha256).not.toBe(row.loopSha256);
      expect(row.exactCameraCoordinatesVerified).toBe(false);
    }
    expect(RECORDING_MANIFEST.some(c => /29833113|34118774|4452/.test(c.originalAssetKey))).toBe(false);
  });

  it('exposes no private paths in public metadata', () => {
    const text = JSON.stringify(RECORDING_MANIFEST) + REVIEW_REF;
    expect(text).not.toMatch(/[A-Za-z]:\\|\/Users\/|\\\\|private|staging/i);
  });
});

it('data adapter preserves legacy identity and rejects conflicting or missing review identities',()=>{
 expect(mergeReviewedViews({a:'view-a'},[{feedId:'a'},{feedId:'b',reviewedViewId:'view-b',reviewRef:'review-b'}])).toEqual({a:'view-a',b:'view-b'});
 expect(()=>mergeReviewedViews({a:'view-a'},[{feedId:'a',reviewedViewId:'wrong',reviewRef:'r'}])).toThrow();
 expect(()=>mergeReviewedViews({},[{feedId:'b',reviewedViewId:'view-b'}])).toThrow();
 expect(()=>mergeReviewedViews({a:'view-a'},[{feedId:'b',reviewedViewId:'view-a',reviewRef:'r'}])).toThrow();
 for(const row of importedRows){const c=RECORDING_MANIFEST.find(c=>c.feedId===row.feedId)!;expect(c.reviewedView).toEqual({viewId:row.reviewedViewId,reviewRef:row.reviewRef});expect(c.originalSha256).toBe(row.originalSha256);expect(row.originalSha256).not.toBe(row.loopSha256);expect(row.creditsSha256).toMatch(/^[a-f0-9]{64}$/);}
});

