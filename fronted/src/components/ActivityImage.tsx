import { useState, useEffect, memo } from 'react';
import { imgCache, loadedCache, buildImageCacheKey, prefetchPixabayImage, picsumFallback } from '../utils';

interface ActivityImageProps {
  activity: string;
  location: string;
  category: string;
  destCountry: string;
  sig: number;
  imageUrl?: string | null;
}

export const ActivityImage = memo(function ActivityImage({
  activity, location, category, destCountry, sig, imageUrl,
}: ActivityImageProps) {
  const cacheKey = buildImageCacheKey(activity, location, category);
  const directSrc = imageUrl?.trim() || null;
  const fallback = picsumFallback(`${destCountry}-${category}-${sig}`);
  const [src, setSrc] = useState<string>(() => directSrc ?? imgCache.get(cacheKey) ?? fallback);
  const [loaded, setLoaded] = useState<boolean>(() => directSrc ? false : (loadedCache.get(cacheKey) ?? false));

  useEffect(() => {
    if (directSrc) {
      setSrc(directSrc);
      setLoaded(false);
      return;
    }

    let cancelled = false;
    prefetchPixabayImage(activity, location, category).then((url) => {
      if (cancelled || !url) return;
      setSrc(url);
      setLoaded(loadedCache.get(cacheKey) ?? false);
    });
    return () => { cancelled = true; };
  }, [activity, location, category, cacheKey, directSrc]);

  return (
    <div className="w-32 h-24 md:w-40 md:h-28 rounded-lg overflow-hidden flex-shrink-0 shadow-sm bg-surface-container-low relative">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-container-high" />}
      <img
        src={src}
        alt={activity}
        loading="lazy"
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => { setLoaded(true); loadedCache.set(cacheKey, true); }}
        onError={() => {
          if (src !== fallback) {
            setSrc(fallback);
            setLoaded(false);
            return;
          }
          // Fallback also failed: stop skeleton and show broken image state only
          setLoaded(true);
          loadedCache.delete(cacheKey);
        }}
      />
    </div>
  );
});
