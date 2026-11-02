FROM oven/bun@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895

# Bun 1.4.2, the packageManager version CI installs, pinned to the multi-platform image digest.

ARG CA_CERTIFICATES_VERSION=20250419
ARG GIT_VERSION=1:2.47.3-0+deb13u1
ARG GIT_LFS_VERSION=3.6.1-1+deb13u1
ARG OPENSSH_CLIENT_VERSION=1:10.0p1-7+deb13u4

USER root

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates=${CA_CERTIFICATES_VERSION} \
        git=${GIT_VERSION} \
        git-lfs=${GIT_LFS_VERSION} \
        openssh-client=${OPENSSH_CLIENT_VERSION} \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system \
    && install -d -o bun -g bun \
        /workspace/open-designer/node_modules \
        /workspace/open-designer/packages/scene-graph/node_modules \
        /workspace/open-designer/packages/pen/node_modules \
        /workspace/open-designer/packages/kiwi/node_modules \
        /workspace/open-designer/packages/fig/node_modules \
        /workspace/open-designer/packages/core/node_modules \
        /workspace/open-designer/packages/dom-css/node_modules \
        /workspace/open-designer/packages/design-jsx/node_modules \
        /workspace/open-designer/packages/emit/node_modules \
        /workspace/open-designer/packages/vue/node_modules \
        /workspace/open-designer/packages/cli/node_modules \
        /workspace/open-designer/packages/mcp/node_modules \
        /workspace/open-designer/packages/docs/node_modules \
        /workspace/open-designer/tools/docs/node_modules

USER bun
