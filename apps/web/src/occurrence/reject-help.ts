/** Ajuda do campo de motivo da recusa: quem recebe o texto. */
export function rejectHelp(count: number): string {
  return count === 1
    ? 'O cidadão que relatou recebe este texto.'
    : `Os ${count} cidadãos que relataram recebem este texto.`;
}
