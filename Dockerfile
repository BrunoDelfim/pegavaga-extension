# Ferramenta de build e teste da extensão PegaVaga.
#
# Esta imagem NÃO roda a extensão: quem carrega o JS é o navegador, na máquina de
# quem usa (o produto é um pacote de arquivos, não um serviço). O que ela entrega
# é o ambiente fechado do build — Node + o compilador TypeScript baixado sem npm
# — para compilar e testar do mesmo jeito em qualquer sistema, inclusive numa
# máquina sem Node nenhum instalado.
#
#   docker compose run --rm extensao            # build (tsc + cabeçalho)
#   docker compose run --rm extensao ./tools/testar.sh
#
# O repositório entra por bind mount (ver o docker-compose.yml) e o toolchain fica
# pronto em /opt/tools para o ponto de entrada copiar quando faltar.
FROM node:22-slim

WORKDIR /extensao

# Requisitos primeiro: baixa o TypeScript e os `@types/chrome` (versão fixa no
# script, sem npm) e guarda fora do repositório. Enquanto o script não mudar, esta
# camada é reaproveitada pelo cache do Docker.
COPY tools/baixar-tipos.js tools/
RUN node tools/baixar-tipos.js && mv tools /opt/tools

COPY docker/entrada.sh /usr/local/bin/entrada
RUN chmod +x /usr/local/bin/entrada

ENTRYPOINT ["entrada"]

# O padrão é o build; o comando passa a ser outro se você mandar outro
# (`docker compose run --rm extensao ./tools/testar.sh`).
CMD ["node", "tools/typescript/bin/tsc", "-p", "."]
