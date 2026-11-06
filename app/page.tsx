import { redirect } from 'next/navigation'

/**
 * Raiz da aplicação: encaminha para o login.
 * A página pública estática (index.html na raiz) é a entrada da prévia.
 */
export default function Home() {
  redirect('/login')
}
