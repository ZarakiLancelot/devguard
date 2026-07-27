#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${AWS_PROFILE:-devguard}"; region="${AWS_REGION:-us-east-1}"; stack="${STACK_NAME:-devguard-static-site}"
cd "$root"
aws --version | grep -q '^aws-cli/2\.'
test "$(aws configure get region --profile "$profile")" = "$region"
arn="$(aws sts get-caller-identity --profile "$profile" --query Arn --output text)"
case "$arn" in arn:aws:sts::*:assumed-role/AWSReservedSSO_DevGuardAdministrator_*/*) ;; *) echo 'Approved DevGuard SSO role required.' >&2; exit 1;; esac
test -f site/index.html
aws cloudformation validate-template --template-body file://infra/static-site/template.yml --profile "$profile" --region "$region" >/dev/null
aws cloudformation deploy --stack-name "$stack" --template-file infra/static-site/template.yml --profile "$profile" --region "$region" --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset
bucket="$(aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"
distribution="$(aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
url="$(aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text)"
test -n "$bucket" && test -n "$distribution"
aws s3 sync site/ "s3://$bucket/" --delete --exclude index.html --cache-control 'public, max-age=86400' --profile "$profile" --region "$region"
aws s3 cp site/index.html "s3://$bucket/index.html" --content-type text/html --cache-control 'no-cache, max-age=0, must-revalidate' --profile "$profile" --region "$region"
invalidation="$(aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' --profile "$profile" --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$distribution" --id "$invalidation" --profile "$profile"
aws cloudfront wait distribution-deployed --id "$distribution" --profile "$profile"
printf 'DevGuard static site deployed: %s\n' "$url"
