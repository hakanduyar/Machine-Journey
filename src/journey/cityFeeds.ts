/**
 * The 21 city-owned archive clips (R49 C): one local clip per demo-routed globe city. This table mirrors
 * `public/media/city-sources.json` (the curated source / licence / hash manifest); `tests/unit/cityFeeds.test.ts` asserts
 * the two never drift. The place named for each clip comes from the stock publisher / contributor's item metadata and
 * was visually screened: it is NOT an official camera location and NOT a verified GPS position. The globe marker is a
 * locality overview point, never a camera position.
 */
export interface CitySource {
  cityId: string;
  /** Compact HUD label from the manifest's `archiveLabel` (ARCHIVE / TIMELAPSE / PAN ...), never "LIVE" or "CCTV". */
  archiveLabel: string;
  credit: string;
  license: string;
  licenseUrl: string;
  /** Public page of the clip (attribution). */
  source: string;
}

const MIXKIT = 'Mixkit Stock Video Free License';
const PEXELS = 'Pexels License';
const MK_URL = 'https://mixkit.co/license/modal/videoFree/';
const PX_URL = 'https://www.pexels.com/license/';

export const CITY_SOURCES: readonly CitySource[] = [
  { cityId: 'paris', archiveLabel: 'ARCHIVE / STREET VIEW', credit: 'Mixkit', license: MIXKIT, licenseUrl: MK_URL, source: 'https://mixkit.co/free-stock-video/a-calm-street-in-paris-4348/' },
  { cityId: 'new-york', archiveLabel: 'ARCHIVE / TIMELAPSE', credit: 'Mixkit', license: MIXKIT, licenseUrl: MK_URL, source: 'https://mixkit.co/free-stock-video/busy-street-in-the-city-4000/' },
  { cityId: 'los-angeles', archiveLabel: 'ARCHIVE / TIMELAPSE', credit: 'Mixkit', license: MIXKIT, licenseUrl: MK_URL, source: 'https://mixkit.co/free-stock-video/the-streets-of-los-angeles-4243/' },
  { cityId: 'reykjavik', archiveLabel: 'ARCHIVE / STREET VIEW', credit: 'Sammy Marrco', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/reykjavik-street-scene-in-dusk-light-30447395/' },
  { cityId: 'cairo', archiveLabel: 'ARCHIVE / CITY PAN', credit: 'Mad Knoxx Deluxe', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/panoramic-view-of-cairo-skyline-34610802/' },
  { cityId: 'nairobi', archiveLabel: 'ARCHIVE / STREET VIEW', credit: 'An Koishi', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/nairobi-town-27918500/' },
  { cityId: 'mumbai', archiveLabel: 'ARCHIVE CAMERA', credit: 'aksinfo7 universe', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/busy-urban-traffic-in-mumbai-cityscape-30350772/' },
  { cityId: 'tokyo', archiveLabel: 'ARCHIVE CAMERA', credit: 'Stephan Leuzinger', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/aerial-view-of-shibuya-crossing-in-tokyo-37570306/' },
  { cityId: 'sydney', archiveLabel: 'ARCHIVE CAMERA', credit: 'Catherine Grenfell', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/sydney-harbour-at-night-slow-mo-18092659/' },
  { cityId: 'sao-paulo', archiveLabel: 'ARCHIVE / ROAD VIEW', credit: 'Gustavo Denuncio', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/aerial-view-of-busy-urban-traffic-in-sao-paulo-31969774/' },
  { cityId: 'mexico-city', archiveLabel: 'ARCHIVE / ROOFTOP PAN', credit: 'Mixkit', license: MIXKIT, licenseUrl: MK_URL, source: 'https://mixkit.co/free-stock-video/the-top-of-a-mexico-city-building-4292/' },
  { cityId: 'moscow', archiveLabel: 'ARCHIVE / STREET VIEW', credit: 'Evgenij Mikhailov', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/traffic-on-road-in-moscow-11933740/' },
  { cityId: 'singapore', archiveLabel: 'ARCHIVE TIMELAPSE', credit: 'Timo Volz', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/singapore-city-skyline-at-night-reflections-30570498/' },
  { cityId: 'johannesburg', archiveLabel: 'ARCHIVE CAMERA', credit: 'K', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/aerial-view-of-johannesburg-cityscape-33644283/' },
  { cityId: 'buenos-aires', archiveLabel: 'ARCHIVE / STREET VIEW', credit: 'LISTOS PARA RODAR | Productora', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/obelisco-argentina-19897024/' },
  { cityId: 'dubai', archiveLabel: 'ARCHIVE TIMELAPSE', credit: 'Nelemson G', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/highway-traffic-in-dubai-city-timelapse-30406741/' },
  { cityId: 'vancouver', archiveLabel: 'ARCHIVE / TIMELAPSE', credit: 'Dmitry Varennikov', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/city-clouds-haze-travel-4265473/' },
  { cityId: 'lagos', archiveLabel: 'ARCHIVE / AERIAL OBSERVATION', credit: 'Vitalis Nwenyi', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/pt-br/video/yaba-lagos-nigeria-31661048/' },
  { cityId: 'istanbul', archiveLabel: 'ARCHIVE TIMELAPSE', credit: 'Mixkit', license: MIXKIT, licenseUrl: 'https://mixkit.co/license/#videoFree', source: 'https://mixkit.co/free-stock-video/tourist-ferries-arriving-at-the-port-4004/' },
  { cityId: 'auckland', archiveLabel: 'ARCHIVE CAMERA', credit: 'Kiwi and Camera', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/busy-downtown-traffic-in-auckland-nz-38824374/' },
  { cityId: 'rome', archiveLabel: 'ARCHIVE / TIMELAPSE', credit: 'Super Lunar', license: PEXELS, licenseUrl: PX_URL, source: 'https://www.pexels.com/video/a-time-lapse-of-the-colosseum-in-rome-4840455/' },
];

export const cityFeedId = (cityId: string) => `city-${cityId}`;
