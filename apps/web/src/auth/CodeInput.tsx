import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import styles from './LoginPage.module.css';

export const CODE_LENGTH = 6;

interface CodeInputProps {
  /** Um dígito (ou vazio) por caixa, sempre com 6 posições. */
  digits: string[];
  onChange: (digits: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/** Seis caixas do código do e-mail: avança sozinho, volta no Backspace e aceita colar. */
export function CodeInput({ digits, onChange, disabled, invalid }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (index: number) => {
    refs.current[Math.min(Math.max(index, 0), CODE_LENGTH - 1)]?.focus();
  };

  /** Escreve `text` a partir da caixa `start` e põe o foco na seguinte. */
  const fill = (start: number, text: string) => {
    const incoming = text.replace(/\D/g, '').slice(0, CODE_LENGTH - start);
    if (!incoming) return;
    const next = [...digits];
    for (let i = 0; i < incoming.length; i++) next[start + i] = incoming[i] ?? '';
    focusBox(start + incoming.length);
    onChange(next);
  };

  const handleChange = (index: number, value: string) => {
    if (value === '') {
      const next = [...digits];
      next[index] = '';
      onChange(next);
      return;
    }
    // Digitar sobre uma caixa preenchida troca o dígito: vale o último digitado.
    fill(index, value.length > 1 ? value.slice(-1) : value);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && digits[index] === '' && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      onChange(next);
      focusBox(index - 1);
    } else if (event.key === 'ArrowLeft') {
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      focusBox(index + 1);
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text');
    // Colar o código inteiro preenche desde a primeira caixa.
    fill(text.replace(/\D/g, '').length >= CODE_LENGTH ? 0 : index, text);
  };

  return (
    <div className={styles.codeBoxes}>
      {digits.map((digit, index) => (
        <input
          // As caixas têm posição fixa: o índice é a identidade.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          className={styles.codeBox}
          aria-label={`Dígito ${index + 1} de ${CODE_LENGTH}`}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={index === 0}
          maxLength={2}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
