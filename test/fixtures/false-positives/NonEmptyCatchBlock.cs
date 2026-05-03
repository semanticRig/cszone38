using System;

public class NonEmptyCatchBlock
{
    public void Run()
    {
        try
        {
            Work();
        }
        catch (Exception ex)
        {
            Console.WriteLine(ex.Message);
        }
    }

    private void Work()
    {
    }
}