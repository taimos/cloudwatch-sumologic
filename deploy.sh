#!/usr/bin/env bash


ENDPOINT=${1:?Missing SumoLogic Endpoint URL}
REGION=${2:?Missing Region name}

export AWS_DEFAULT_REGION=${REGION}
export AWS_REGION=${REGION}

set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SAM_BUCKET=${ACCOUNT_ID}-sam-deploy-${AWS_REGION}
STACK_NAME=cloudwatch-sumologic

if ! aws s3api head-bucket --bucket "${SAM_BUCKET}" 2>/dev/null; then
 echo "Please create S3 bucket \"${SAM_BUCKET}\" as deployment bucket"
 echo "This bucket can be reused for all your SAM deployments"
 echo ""
 echo "aws s3 mb s3://${SAM_BUCKET}"
 exit 1
fi

cd log-forwarder
npm install
npm test
npm prune --production
cd ..
cd loggroup-config
npm install
npm test
npm prune --production
cd ..

aws cloudformation package --template-file cfn.yaml --s3-bucket ${SAM_BUCKET} --s3-prefix ${STACK_NAME} --output-template-file cfn.packaged.yaml

aws cloudformation deploy --template-file cfn.packaged.yaml --stack-name ${STACK_NAME} --capabilities CAPABILITY_IAM \
    --parameter-overrides SumoLogicEndpoint=${ENDPOINT} || echo "No Update"