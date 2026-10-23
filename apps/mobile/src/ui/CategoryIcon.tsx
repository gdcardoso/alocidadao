import type { IconGroup } from '@alocidadao/shared';
import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { categoryIcon, groupColors } from './category';
import { radius } from './theme';

export interface CategoryIconProps {
  icon: string | null;
  group: IconGroup;
  /** `square`: 48, raio 14 (lista). `circle`: 44 (opção da Nova solicitação). */
  shape?: 'square' | 'circle';
}

/** Ícone da categoria sobre a cor do grupo. Decorativo: o nome da categoria vem ao lado. */
export function CategoryIcon({ icon, group, shape = 'square' }: CategoryIconProps) {
  const { bg, fg } = groupColors(group);
  return (
    <View
      style={[
        styles.base,
        shape === 'square' ? styles.square : styles.circle,
        { backgroundColor: bg },
      ]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {createElement(categoryIcon(icon), { size: shape === 'square' ? 24 : 22, color: fg })}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  square: { width: 48, height: 48, borderRadius: radius.digit },
  circle: { width: 44, height: 44, borderRadius: 22 },
});
