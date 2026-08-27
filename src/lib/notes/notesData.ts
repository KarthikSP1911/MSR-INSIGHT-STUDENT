/**
 * Static Notes & PYQs links, ported verbatim from NotesSection.tsx — this is
 * hardcoded content in the source (only IS branch, semester 6, is
 * populated), not data-driven. Kept as-is; a real content source would be a
 * separate follow-up, not part of this port.
 */

/** Master folder links (semester level), keyed by branch code then semester number. */
export const DRIVE_LINKS: Record<string, Record<number, string>> = {
  IS: {
    6: "https://drive.google.com/drive/folders/1ADjH5X3tCD7-0TVx78bXia-kfWWqZg6J?usp=share_link",
  },
};

/** Subject-specific links, keyed by subject code. */
export const SUBJECT_LINKS: Record<string, { notes?: string; pyqs?: string }> = {
  "23AL61": {
    notes: "https://drive.google.com/drive/folders/1_cbJig5GJo2wlM8uBywz928lYfDx3J8M?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
  "23IS62": {
    notes: "https://drive.google.com/drive/folders/15WES3thfnamGNGIl5q2DtD_3NBGawLyP?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
  "23ISL65": {
    notes: "https://drive.google.com/drive/folders/1L7MrBiRxaxDvuOk9sK3qq2RZk8BfQ7kE?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
  "23ISE633": {
    notes: "https://drive.google.com/drive/folders/1WOp1h9uL6_BeooJw4-L8adGYMt1k9tYp?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
  "23ISE644": {
    notes: "https://drive.google.com/drive/folders/1gCfPay291RDmi0uusxI3n55MTHp199HT?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
  "23ISE641": {
    notes: "https://drive.google.com/drive/folders/1bKqbUga9QCZYjAXD2hUbBbmbOgaIIvZC?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
  "23ISE632": {
    notes: "https://drive.google.com/drive/folders/1x5POkwugM4M59CFyLyIo_zDOb8-ptiu0?usp=share_link",
    pyqs: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
  },
};
