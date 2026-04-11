export interface CharacterClassCatalogItem {
  classId: string;
  displayName: string;
  description: string;
  artKey: string;
  enabled: boolean;
}

const CLASS_CATALOG: CharacterClassCatalogItem[] = [
  {
    classId: "soldier",
    displayName: "Soldier",
    description: "Balanced frontline survivor built for clean progression through early zones.",
    artKey: "class-soldier",
    enabled: true,
  },
  {
    classId: "scout",
    displayName: "Scout",
    description: "Fast reconnaissance specialist with a lighter battlefield profile.",
    artKey: "class-scout",
    enabled: true,
  },
  {
    classId: "warden",
    displayName: "Warden",
    description: "Defensive specialist tuned for attrition and controlled recovery between fights.",
    artKey: "class-warden",
    enabled: true,
  },
];

export function listEnabledCharacterClasses(): CharacterClassCatalogItem[] {
  return CLASS_CATALOG.filter((item) => item.enabled).map((item) => ({ ...item }));
}

export function getCharacterClassCatalogItem(
  classId: string,
): CharacterClassCatalogItem | null {
  return CLASS_CATALOG.find((item) => item.classId === classId) ?? null;
}
