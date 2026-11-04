import { useLocalSearchParams } from 'expo-router';
import { LegalDocumentView } from '../legal/LegalDocumentView';

/** Texto dos documentos legais; `?aceite=1` (vindo de uma caixa de aceite) traz "Li e concordo". */
export default function TermosScreen() {
  const { aceite } = useLocalSearchParams<{ aceite?: string }>();
  return <LegalDocumentView slug="termos" fromAcceptance={aceite === '1'} />;
}
