import { CITY_SOURCES, cityFeedId } from './cityFeeds';

export interface Feed {
  id: string;
  /** Camera label taken from the source dataset / clip title, not invented. */
  label: string;
  credit: string;
  /** City-owned stock clips: public page + licence of the clip (attribution). */
  source?: string;
  licenseUrl?: string;
}

const MEVA = 'MEVA · Kitware, Inc. / IARPA · CC BY 4.0';

export const FEEDS: Feed[] = [
  { id: 'm01', label: 'G326 ADMIN', credit: MEVA },
  { id: 'm02', label: 'G341 HOSPITAL', credit: MEVA },
  { id: 'm03', label: 'G301 HOSPITAL', credit: MEVA },
  { id: 'm04', label: 'G436 HOSPITAL', credit: MEVA },
  { id: 'm06', label: 'G328 SCHOOL', credit: MEVA },
  { id: 'm07', label: 'G639 SCHOOL', credit: MEVA },
  { id: 'covered-road', label: 'G505 BUS', credit: MEVA },
  { id: 'parking-walk', label: 'G424 SCHOOL', credit: MEVA },
  { id: 'docked-cargo', label: 'DOCKED CARGO', credit: 'Mixkit · Free Stock Video License' },
  { id: 'parked-c130', label: 'PARKED C-130', credit: 'DVIDS / 165th Airlift Wing · public domain' },
  // Added in R47: two further distinct real clips (not crops of existing ones). Catalog length is 12; code reads FEEDS.length.
  { id: 'm05', label: 'G330 GYM', credit: MEVA },
  { id: 'palmdale-dc8', label: 'PALMDALE DC-8', credit: 'NASA · video by Steve Parcel · public domain' },
];

/**
 * R49 C: the 21 city-owned archive clips. They are NOT part of `FEEDS` (the twelve CORE feeds keep their ids, order,
 * mosaic / floating-field / neural content and poster pool). They exist as inert, source-less <video> elements and
 * attach their source lazily, only when their city is the upcoming / current target (see Journey `attachCityMedia`).
 */
export const CITY_FEEDS: Feed[] = CITY_SOURCES.map((s) => ({
  id: cityFeedId(s.cityId),
  label: s.archiveLabel,
  credit: `${s.credit} · ${s.license}`,
  source: s.source,
  licenseUrl: s.licenseUrl,
}));
/** Every playable element, core first: indices < CORE_FEED_COUNT are the original pool. */
export const ALL_FEEDS: Feed[] = [...FEEDS, ...CITY_FEEDS];
export const CORE_FEED_COUNT = FEEDS.length;
export const isCityFeed = (feedId: string | null | undefined): boolean => !!feedId && feedId.startsWith('city-');
/** Virtual tile id of a city-owned feed: it has no tile in the (core-only) mosaic layout, but can be selected and recorded. */
export const VIRTUAL_TILE_PREFIX = 'virtual:';
export const virtualTileId = (feedId: string) => `${VIRTUAL_TILE_PREFIX}${feedId}`;
export const feedOfVirtualTile = (tileId: string): string | null => (tileId.startsWith(VIRTUAL_TILE_PREFIX) ? tileId.slice(VIRTUAL_TILE_PREFIX.length) : null);

export const feedVideoUrl = (f: Feed) => `${import.meta.env.BASE_URL}media/${f.id}/loop.mp4`;
export const feedPosterUrl = (f: Feed) => `${import.meta.env.BASE_URL}media/${f.id}/poster.jpg`;

/** Years of the lateral archive axis; a navigation device, not capture dates. */
export const YEARS = [2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016];
