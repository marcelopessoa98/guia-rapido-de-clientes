# Guia rápido de clientes — Concrefuji

Aplicação web estática em JavaScript puro para consultar e administrar clientes, obras e referências no Firebase Realtime Database.

## Recursos

- Acesso restrito aos usuários cadastrados no Firebase Authentication.
- Pesquisa por referência, cliente ou obra.
- Resultados em cards com todos os dados da obra e da referência visíveis.
- Cadastro e edição de todos os dados da obra.
- Uma ou mais referências alfabéticas de 2 ou 3 letras por obra.
- Sugestão automática da próxima referência disponível.
- Registro permanente: referências de obras finalizadas ou excluídas nunca são reutilizadas.
- Exclusão lógica com preservação do histórico e da auditoria.
- Interface responsiva pronta para Vercel.
- PWA instalável em celulares e computadores, com cache somente dos arquivos da interface.

## Estrutura do banco

- `usuarios`: perfil, função e situação dos usuários autorizados.
- `clientes`: clientes cadastrados.
- `obras`: obras e todos os campos importados da planilha.
- `referencias`: registro transacional e permanente das referências.
- `auditoria`: histórico das alterações realizadas.

As regras do Realtime Database exigem autenticação e respeitam os papéis `ADMIN`, `EDITOR` e `LEITOR`. O bloqueio de duplicidade usa uma transação em `referencias` antes de salvar uma obra.

## Dados da planilha

Os dados foram enviados diretamente ao Realtime Database e não fazem parte do repositório. Arquivos locais de carga, relatório e backup estão no `.gitignore`.

O script `tools/build-seed.ps1` é uma ferramenta administrativa local para validar a planilha. Ele não é executado pela aplicação e não publica dados no GitHub.

## Publicação

Não há etapa de build ou dependências npm. Importe o repositório na Vercel como site estático.

Para atualizar somente as regras autenticadas do banco:

```bash
firebase deploy --only database --project clientes-referencias
```
