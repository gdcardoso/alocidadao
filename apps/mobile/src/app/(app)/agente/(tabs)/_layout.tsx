import {
  BottomTabBarHeightCallbackContext,
  Tabs,
  type BottomTabBarProps,
} from 'expo-router/js-tabs';
import { useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { TabBar } from '../../../../ui/TabBar';
import { colors } from '../../../../ui/theme';

/** Abas do agente (A1 e Perfil), com a barra flutuante de duas abas por cima do conteúdo. */
export default function AgentTabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={renderTabBar}
    >
      <Tabs.Screen name="atividades" options={{ title: 'Atividades' }} />
      <Tabs.Screen name="perfil" options={{ title: 'Perfil' }} />
    </Tabs>
  );
}

const renderTabBar = (props: BottomTabBarProps) => <FloatingTabBar {...props} />;

function FloatingTabBar({ state, navigateToTab }: BottomTabBarProps) {
  // As telas leem a altura com useBottomTabBarHeight para o fim da lista não ficar embaixo.
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const current = state.routes[state.index]?.name;
  const goTo = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route) navigateToTab(route.key);
  };
  return (
    <View
      style={styles.floating}
      pointerEvents="box-none"
      onLayout={(e) => reportHeight?.(e.nativeEvent.layout.height)}
    >
      <TabBar
        variant="agent"
        active={current === 'perfil' ? 'profile' : 'activities'}
        onNavigate={(tab) => goTo(tab === 'profile' ? 'perfil' : 'atividades')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  floating: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
