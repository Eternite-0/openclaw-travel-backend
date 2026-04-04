import { useState, useEffect, memo } from 'react';
import { imgCache, loadedCache, buildImageCacheKey, prefetchPixabayImage, picsumFallback } from '../utils';

interface ActivityImageProps {
  activity: string;
  location: string;
  category: string;
  destCountry: string;
  sig: number;
}

export const ActivityImage = memo(function ActivityImage({
  activity, location, category, destCountry, sig,
}: ActivityImageProps) {
  const cacheKey = buildImageCacheKey(activity, location, category);
  const fallback = picsumFallback(`${destCountry}-${category}-${sig}`);
  const [src, setSrc] = useState<string>(() => imgCache.get(cacheKey) ?? fallback);
  const [loaded, setLoaded] = useState<boolean>(() => loadedCache.get(cacheKey) ?? false);

  useEffect(() => {
    let cancelled = false;
    prefetchPixabayImage(activity, location, category).then((url) => {
      if (cancelled || !url) return;
      setSrc(url);
      setLoaded(loadedCache.get(cacheKey) ?? false);
    });
    return () => { cancelled = true; };
  }, [activity, location, category, cacheKey]);

  return (
    <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 shadow-sm bg-surface-container-low relative">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-container-high" />}
      <img
        src={src}
        alt={activity}
        loading="lazy"
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => { setLoaded(true); loadedCache.set(cacheKey, true); }}
        onError={() => { if (src !== fallback) { setSrc(fallback); setLoaded(false); loadedCache.delete(cacheKey); } }}
      />
    </div>
  );
});
