# Parent images are:
# https://pkgs.devel.redhat.com/cgit/containers/s2i-core/tree/Dockerfile?h=rhel-8.5.0
# http://pkgs.devel.redhat.com/cgit/containers/nodejs-14/tree/Dockerfile?h=rhel-8.5.0
#
# Find brew container builds at:
# https://brewweb.engineering.redhat.com/brew/search?match=glob&type=build&terms=*nodejs-14*
#
# Take s2i image
# Do not follow s2i convinience, because:
#  * s2i mainly targets openshift, can be used only in specific workflows
#  * s2i introduces new dependencies to code location
#  * s2i requires additional tools for image build
#  * s2i is vendor-lock for s2i images
#  * build image with buildah is simple and convinient, and universal
#  * use full benefits of RedHat images, but build images in simple form
#
# NPM_RUN - Select an alternate / custom runtime mode, defined in your package.json files' scripts section:
# * start:listener
# * start:loader
# http://pkgs.devel.redhat.com/cgit/containers/nodejs-14/tree/Dockerfile?h=rhel-8.5.0#n15

FROM registry.access.redhat.com/ubi8/nodejs-18
USER root
ARG ADDPKGS
RUN yum install -y krb5-workstation $ADDPKGS && \
    yum clean all -y
COPY rhcachain.crt "$HOME/"
RUN trust anchor --store "${HOME}/rhcachain.crt"
USER 1001
COPY src $HOME/src/
COPY assets $HOME/assets/
COPY package.json package-lock.json env.sh tsconfig.json $HOME/
COPY .npmrcs/$NPMLOCATION .npmrc
# Allow user to use the lockfiles etc
USER root
RUN chown -R 1001:0 $HOME

USER 1001
ARG NPMLOCATION="open"
RUN ["bash","-c", "--", "npm install"]
RUN ["bash","-c", "--", "npm run build"]
CMD ["bash","-c", "--", "$STI_SCRIPTS_PATH/run"]
