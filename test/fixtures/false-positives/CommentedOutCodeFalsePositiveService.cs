public class CommentedOutCodeFalsePositiveService
{
    public void Configure()
    {
        // Copyright (c) Microsoft Corporation. All rights reserved.
        // Licensed under the MIT License.
        // Use GetById(id) to retrieve a single record.
        // Previously: context.SaveChanges() was called here.
        // Do not call repo.Delete() directly.
        var value = 1;
    }
}