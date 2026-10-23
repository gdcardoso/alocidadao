import { Image, StyleSheet, View } from 'react-native';

// Tela 0 do Pencil: imagem de fundo (cidade e faixa verde e amarela) e a logo, sem texto.
// Aparece só enquanto a sessão guardada é conferida.
export default function Abertura() {
  return (
    <View style={styles.screen} accessible accessibilityLabel="Alô Cidadão">
      <Image
        source={require('../../assets/abertura.png')}
        resizeMode="cover"
        style={styles.background}
      />
      <View style={styles.logoArea}>
        <Image source={require('../../assets/logo.png')} resizeMode="contain" style={styles.logo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  background: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  // No Pencil a logo fica em y=250 de 844 (30% da altura).
  logoArea: { position: 'absolute', top: '29.6%', left: 0, right: 0, alignItems: 'center' },
  logo: { width: 300, height: 130 },
});
