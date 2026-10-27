/** A player's flair (an emoji they chose), shown after their name. */
export function Flair({ flair }: { flair: string | null | undefined }) {
  return flair ? <span className="flair"> {flair}</span> : null;
}
