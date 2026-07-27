#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; profile="${AWS_PROFILE:-devguard}"; region="${AWS_REGION:-us-east-1}"; stack="${STACK_NAME:-devguard-static-site}"
cd "$root"
if [ "${CONFIRM_DESTROY:-}" != YES ]; then read -r -p "Delete DevGuard static site stack? Type YES: " answer; [ "$answer" = YES ] || exit 1; fi
bucket="$(aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"
test -n "$bucket"
aws s3 rm "s3://$bucket" --recursive --profile "$profile" --region "$region"
aws cloudformation delete-stack --stack-name "$stack" --profile "$profile" --region "$region"
aws cloudformation wait stack-delete-complete --stack-name "$stack" --profile "$profile" --region "$region"
printf '%s\n' 'DevGuard static site stack deleted.'
