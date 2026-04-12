export interface CharacterClassCatalogItem {
  classId: string;
  compactId: number;
  displayName: string;
  description: string;
  artKey: string;
  enabled: boolean;
}

const CLASS_CATALOG: CharacterClassCatalogItem[] = [
  {
    classId: "soldier",
    compactId: 1,
    displayName: "Soldier",
    description: "Balanced frontline survivor built for clean progression through early zones.",
    artKey: "class-soldier",
    enabled: true,
  },
  {
    classId: "scout",
    compactId: 2,
    displayName: "Scout",
    description: "Fast reconnaissance specialist with a lighter battlefield profile.",
    artKey: "class-scout",
    enabled: true,
  },
  {
    classId: "warden",
    compactId: 3,
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

export function getEnabledClassRegistrySeedEntries(): Array<{
  classId: string;
  compactId: number;
  enabled: boolean;
}> {
  return CLASS_CATALOG.map((item) => ({
    classId: item.classId,
    compactId: item.compactId,
    enabled: item.enabled,
  }));
}

export function getCompactClassId(classId: string): number {
  const item = getCharacterClassCatalogItem(classId);
  if (item === null) {
    throw new Error(`ERR_UNKNOWN_CLASS_ID: unknown class id ${classId}`);
  }

  return item.compactId;
}
