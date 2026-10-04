// Single source of truth for every fact and every line of copy on the page.
// Facts carry their provenance; nothing here is invented. See .research/business/nanabi-facts.md.

export type Lang = "fr" | "en";
export type L10n = Record<Lang, string>;

export const facts = {
  name: "NANABi AFROMARKET",
  // Her own spelling on socials is "NanaBi"; the sign reads "NANABi".
  shortName: "NanaBi",
  // Source: Instagram story highlight cover "34 rue de la république St cyprien" (150 px, read as LIKELY).
  street: "34, rue de la République",
  postcode: "31300",
  city: "Toulouse",
  district: "Saint-Cyprien",
  // Source: storefront sign + Instagram reel overlay.
  phoneDisplay: "07 84 60 89 09",
  phoneHref: "tel:+33784608909",
  // Source: Facebook page (single m). The physical sign misspells it.
  email: "nanabi.afromarket@gmail.com",
  // Source: fr.wikipedia.org — the station sits on rue de la République.
  metro: { line: "A", station: "Saint-Cyprien – République" },
  socials: [
    { id: "tiktok", label: "TikTok", handle: "@nanabi2023", href: "https://www.tiktok.com/@nanabi2023" },
    { id: "instagram", label: "Instagram", handle: "@nanabiafromarket", href: "https://www.instagram.com/nanabiafromarket/" },
    { id: "facebook", label: "Facebook", handle: "Nanabi Afromarket", href: "https://www.facebook.com/profile.php?id=61552598014032" },
  ],
  mapsHref:
    "https://www.google.com/maps/search/?api=1&query=NANABi+AFROMARKET+34+rue+de+la+R%C3%A9publique+31300+Toulouse",
} as const;

export const sign = {
  // The four words painted on her sign, kept in her order.
  aisles: {
    fr: ["Produits Afro", "Habillement", "Coiffure", "Cosmétique"],
    en: ["Afro Goods", "Clothing", "Hair", "Beauty"],
  },
} as const;

export const ui = {
  skipFilm: { fr: "Passer le film", en: "Skip the film" },
  watchFilm: { fr: "Voir le film", en: "Watch the film" },
  directions: { fr: "Itinéraire", en: "Directions" },
  call: { fr: "Appeler", en: "Call" },
  write: { fr: "Écrire", en: "Email" },
  demoLabel: { fr: "Direction artistique", en: "Art direction" },
  endingLabel: { fr: "Fin du film", en: "Film ending" },
  langLabel: { fr: "Langue", en: "Language" },
  scrollCue: { fr: "Faites défiler pour entrer", en: "Scroll to step in" },
} satisfies Record<string, L10n>;

export type ChapterId = "rue" | "seuil" | "allee" | "or" | "tetes";

export const chapters: { id: ChapterId; numeral: string; title: L10n; line: L10n }[] = [
  {
    id: "rue",
    numeral: "I",
    title: { fr: "La rue", en: "The street" },
    line: { fr: "Rue de la République, une vitrine reste allumée.", en: "On rue de la République, one window stays lit." },
  },
  {
    id: "seuil",
    numeral: "II",
    title: { fr: "Le seuil", en: "The threshold" },
    line: { fr: "Poussez la porte. Dedans, la couleur commence.", en: "Push the door. Inside, the colour begins." },
  },
  {
    id: "allee",
    numeral: "III",
    title: { fr: "L’allée", en: "The aisle" },
    line: { fr: "Du wax du sol au plafond, et un sol de marbre pour le regarder.", en: "Wax from floor to ceiling, and a marble floor to look at it on." },
  },
  {
    id: "or",
    numeral: "IV",
    title: { fr: "L’or", en: "The gold" },
    line: { fr: "Des médailles d’or, des perles, des cauris. Ce qui brille se porte.", en: "Gold medallions, beads, cowries. What shines is worn." },
  },
  {
    id: "tetes",
    numeral: "V",
    title: { fr: "Les têtes", en: "The heads" },
    line: { fr: "Perruques, geles, foulards. Ici, on change de tête.", en: "Wigs, geles, headwraps. Here, you change your look." },
  },
];

export const letter = {
  eyebrow: { fr: "Bienvenue", en: "Welcome" },
  title: { fr: "On entre pour un wax, on ressort avec une histoire.", en: "You come in for a wax print. You leave with a story." },
  body: {
    fr: [
      "Chez NanaBi, on vient chercher un pagne pour un mariage, une perruque pour lundi, un beurre pour les cheveux, des racines du dernier arrivage.",
      "On repart souvent avec autre chose : un collier en ébène, le nom d’un motif, un conseil pour nouer son foulard.",
      "Des pièces d’Afrique et d’Europe, choisies une par une, dans une boutique de Saint-Cyprien.",
    ],
    en: [
      "At NanaBi, people come in for a print for a wedding, a wig for Monday, a butter for their hair, roots from the latest delivery.",
      "They often leave with something else: an ebony necklace, the name of a pattern, a tip for tying a headwrap.",
      "Pieces from Africa and Europe, chosen one by one, in a shop in Saint-Cyprien.",
    ],
  },
  signoff: "NanaBi",
} as const;

export type AisleId = "produits" | "habillement" | "coiffure" | "cosmetique";

export const aisles: { id: AisleId; title: L10n; items: L10n; image: string; alt: L10n }[] = [
  {
    id: "habillement",
    title: { fr: "Habillement", en: "Clothing" },
    items: {
      fr: "Robes et ensembles en wax, kaftans, dashikis, chemises et bombers en wax, smocks tissés.",
      en: "Wax dresses and two-piece sets, kaftans, dashikis, wax shirts and bombers, woven smocks.",
    },
    image: "/img/aisle-habillement.jpg",
    alt: { fr: "Portants de robes et chemises en wax dans la boutique", en: "Racks of wax-print dresses and shirts in the shop" },
  },
  {
    id: "coiffure",
    title: { fr: "Coiffure", en: "Hair" },
    items: {
      fr: "Perruques afro, tresses, geles, foulards et turbans en wax, bonnets.",
      en: "Afro wigs, braids, geles, wax headwraps and turbans, caps.",
    },
    image: "/img/aisle-coiffure.jpg",
    alt: { fr: "Mur de têtes de mannequin coiffées de perruques et de geles", en: "Wall of mannequin heads wearing wigs and geles" },
  },
  {
    id: "cosmetique",
    title: { fr: "Cosmétique", en: "Beauty" },
    items: {
      fr: "Beurres et huiles, soins pour cheveux texturés, savons, crèmes.",
      en: "Butters and oils, care for textured hair, soaps, creams.",
    },
    image: "/img/aisle-cosmetique.jpg",
    alt: { fr: "Étagères de soins capillaires et de beurres", en: "Shelves of hair care and butters" },
  },
  {
    id: "produits",
    title: { fr: "Produits Afro", en: "Afro Goods" },
    items: {
      fr: "Plantes, racines et écorces séchées, sacs en wax, colliers et cauris, masques et vannerie, djembés, éventails.",
      en: "Dried plants, roots and barks, wax bags, necklaces and cowries, masks and basketry, djembés, fans.",
    },
    image: "/img/aisle-produits.jpg",
    alt: { fr: "Sacs en wax aux anses en rotin et colliers de perles", en: "Wax bags with rattan handles and bead necklaces" },
  },
];

// General vocabulary a customer meets in the shop. Definitions are encyclopaedic, not claims about her stock.
export const lexicon: { term: string; title: L10n; def: L10n }[] = [
  {
    term: "wax",
    title: { fr: "Wax", en: "Wax" },
    def: {
      fr: "Coton imprimé à la cire des deux côtés, puis teint. Les fines craquelures du motif sont la signature du procédé, pas un défaut.",
      en: "Cotton printed with wax on both sides, then dyed. The fine crackle in the pattern is the signature of the process, not a flaw.",
    },
  },
  {
    term: "pagne",
    title: { fr: "Pagne", en: "Pagne" },
    def: {
      fr: "La mesure du wax : la pièce fait six yards, soit trois pagnes de deux yards. On le noue, ou on le confie à la couturière.",
      en: "How wax is measured: a piece is six yards, or three pagnes of two yards. Worn tied, or taken to a tailor.",
    },
  },
  {
    term: "gele",
    title: { fr: "Gele", en: "Gele" },
    def: {
      fr: "Grand foulard de tête rigide, noué haut et sculpté, porté pour les fêtes. Le mot vient du yoruba.",
      en: "A large, stiff headwrap tied high and sculpted, worn for celebrations. The word is Yoruba.",
    },
  },
  {
    term: "kente",
    title: { fr: "Kente", en: "Kente" },
    def: {
      fr: "Étoffe tissée en bandes étroites cousues ensemble, née au Ghana, chez les Ashanti et les Ewe.",
      en: "Cloth woven in narrow strips sewn together, born in Ghana among the Ashanti and the Ewe.",
    },
  },
  {
    term: "bogolan",
    title: { fr: "Bogolan", en: "Bogolan" },
    def: {
      fr: "Toile de coton du Mali, peinte à la terre fermentée. Ses motifs reviennent aujourd’hui sur les sacs et les imprimés.",
      en: "Malian cotton cloth painted with fermented mud. Its motifs now return on bags and prints.",
    },
  },
  {
    term: "cauri",
    title: { fr: "Cauri", en: "Cowrie" },
    def: {
      fr: "Petit coquillage blanc qui servit longtemps de monnaie. On le porte aujourd’hui en collier et en bracelet.",
      en: "A small white shell long used as currency. Today it is worn on necklaces and bracelets.",
    },
  },
  {
    term: "nana-benz",
    title: { fr: "Nana Benz", en: "Nana Benz" },
    def: {
      fr: "Surnom des commerçantes de pagnes de Lomé qui, dans les années 1960 et 1970, bâtirent des fortunes avec le wax et roulaient en Mercedes.",
      en: "Nickname of the wax traders of Lomé who, in the 1960s and 1970s, built fortunes on wax prints and drove Mercedes cars.",
    },
  },
];

export const heads = {
  eyebrow: { fr: "Le mur des têtes", en: "The wall of heads" },
  title: { fr: "Changez de tête, pas de boutique.", en: "Change your look, not your shop." },
  body: {
    fr: "Perruques afro auburn, noires ou prune, geles dorés, verts, bordeaux, foulards en wax et colliers de corail. Chaque tête du mur se porte.",
    en: "Afro wigs in auburn, black or plum, gold, green and burgundy geles, wax headwraps and coral necklaces. Every head on the wall can be worn.",
  },
} as const;

export const gold = {
  eyebrow: { fr: "L’or et les perles", en: "Gold and beads" },
  title: { fr: "Ce qui brille se porte.", en: "What shines is worn." },
  body: {
    fr: "Grandes médailles martelées, colliers en ébène, perles de verre, cauris et bracelets tressés. Posés sur le wax qui leur répond.",
    en: "Large hammered medallions, ebony necklaces, glass beads, cowries and braided bangles. Set on the wax that answers them.",
  },
} as const;

export const visit = {
  eyebrow: { fr: "Venir", en: "Visit" },
  title: { fr: "La porte est ouverte.", en: "The door is open." },
  hoursNote: {
    fr: "Horaires du jour : un appel suffit.",
    en: "Today’s hours: one call is enough.",
  },
  metroLabel: { fr: "Métro", en: "Metro" },
} as const;
