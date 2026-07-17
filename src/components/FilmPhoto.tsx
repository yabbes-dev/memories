type FilmPhotoProps = {
  src: string;
  alt: string;
  className?: string;
};

/**
 * Renders an image with a CSS film-camera look:
 * warm grade, vignette, light grain, soft highlight wash.
 */
export function FilmPhoto({ src, alt, className = "" }: FilmPhotoProps) {
  return (
    <div className={`film-frame ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="film-frame__image" loading="lazy" />
      <span className="film-frame__grade" aria-hidden />
      <span className="film-frame__vignette" aria-hidden />
      <span className="film-frame__grain" aria-hidden />
    </div>
  );
}
