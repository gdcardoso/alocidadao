import { router } from 'expo-router';
import {
  BottomTabBarHeightCallbackContext,
  Tabs,
  type BottomTabBarProps,
} from 'expo-router/js-tabs';
import { useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { TabBar } from '../../../ui/TabBar';
import { colors } from '../../../ui/theme';

/** Nova solicitação (Task 9). */
const NEW_REQUEST_ROUTE = '/(app)/nova';

/** Abas das telas 4 e 8, com a barra flutuante do Pencil por cima do conteúdo. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={renderTabBar}
    >
      <Tabs.Screen name="solicitacoes" options={{ title: 'Solicitações' }} />
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
        active={current === 'perfil' ? 'profile' : 'requests'}
        onNavigate={(tab) => {
          if (tab === 'new') router.push(NEW_REQUEST_ROUTE);
          else goTo(tab === 'profile' ? 'perfil' : 'solicitacoes');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  floating: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
