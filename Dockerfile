# Parent images are:
# https://pkgs.devel.redhat.com/cgit/containers/s2i-core/tree/Dockerfile?h=rhel-8.5.0
# http://pkgs.devel.redhat.com/cgit/containers/nodejs-14/tree/Dockerfile?h=rhel-8.5.0
#
# Find brew container builds at:
# https://brewweb.engineering.redhat.com/brew/search?match=glob&type=build&terms=*nodejs-14*
#
# Take s2i image, but use generic "Use multi-stage builds" mechanism:
# https://docs.docker.com/develop/develop-images/multistage-build/
# Do not follow s2i convinience, because:
#  * s2i mainly targets openshift
#  * requires additional tools for image build
#  * build image with: buildah
#
# NPM_RUN - Select an alternate / custom runtime mode, defined in your package.json files' scripts section:
# * start:listener
# * start:loader
# http://pkgs.devel.redhat.com/cgit/containers/nodejs-14/tree/Dockerfile?h=rhel-8.5.0#n15

#
# Builder
#

FROM registry.access.redhat.com/ubi8/nodejs-14 as builder
# work or open
ARG NPMLOCATION="work"
# current dir is HOME=/opt/app-root/src
# https://pkgs.devel.redhat.com/cgit/containers/s2i-core/tree/Dockerfile?h=rhel-8.5.0#n27
COPY tsconfig.json package.json package-lock.json ./
COPY src ./src/
COPY assets ./assets/
COPY .npmrcs/$NPMLOCATION .npmrc
RUN ["bash","-c", "--", "npm install"]
RUN ["bash","-c", "--", "npm run build"]

#
# Runner
#

FROM registry.access.redhat.com/ubi8/nodejs-14 as runner
USER root
ARG ADDPKGS
RUN yum install -y krb5-workstation $ADDPKGS && \
    yum clean all -y
USER 1001
COPY --from=builder $HOME/build $APP_ROOT
CMD ["bash","-c", "--", "$STI_SCRIPTS_PATH/run"]
